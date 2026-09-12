/**
 * Pure automation math: trigger validation, next-due derivation, run-outcome
 * application, and durable-record decoding. No IO, no clock, no timers.
 * @module @deepseek-ai/dsh-automation/src/domain
 */

import { Cron } from 'croner'
import { isAbsolute } from 'node:path'
import { AutomationId, type AutomationId as AutomationIdType } from './brand.ts'
import type {
  AutomationCreateInput,
  AutomationRecord,
  AutomationRunSummary,
  AutomationTrigger,
  AutomationTriggerInput,
} from './types.ts'

/** Minimum whole seconds between two occurrences of any recurring trigger. */
export const MIN_TRIGGER_INTERVAL_SECONDS = 300

/** Largest millisecond delay one `setTimeout` arm can carry; longer waits re-arm in segments. */
export const MAX_TIMER_DELAY_MS = 2_147_483_647

/** Input rejected before any durable effect; the message is model-facing. */
export class AutomationInputError extends Error {
  /** Constructs one rejected-input error.
   * @param message - model-facing rejection reason.
   */
  constructor(message: string) {
    super(message)
    this.name = 'AutomationInputError'
  }
}

/** Require one non-empty string.
 * @param value - unvalidated input field.
 * @param field - field name for the rejection message.
 * @throws {@link AutomationInputError} when the value is not a non-empty string.
 */
function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AutomationInputError(`${field} must be a non-empty string`)
  }
  return value
}

/**
 * One reusable cron evaluator for a `cron` trigger.
 * @param trigger - the cron trigger to evaluate.
 * @returns the evaluator; `nextRun` on it returns `null` when no occurrence remains.
 */
function cronOf(trigger: Extract<AutomationTrigger, { kind: 'cron' }>): Cron {
  // Construction without a callback schedules nothing; the evaluator is inert.
  return new Cron(trigger.expression, {
    ...(trigger.timeZone === undefined ? {} : { timezone: trigger.timeZone }),
  })
}

/**
 * First cron occurrence strictly after one instant.
 * @param trigger - the cron trigger to evaluate.
 * @param afterMs - occurrences at or before this instant are skipped.
 * @returns the next occurrence in epoch milliseconds, or `null` when none remains.
 */
export function cronNextAt(trigger: Extract<AutomationTrigger, { kind: 'cron' }>, afterMs: number): number | null {
  const next = cronOf(trigger).nextRun(new Date(afterMs))
  return next === null ? null : next.getTime()
}

/**
 * Validate one create input and snapshot it into record shape.
 * @param input - unvalidated creation input.
 * @param id - runtime-allocated identity.
 * @param now - creation instant in epoch milliseconds.
 * @returns the validated record with no runs yet.
 * @throws {@link AutomationInputError} when any field is invalid.
 */
export function createAutomationRecord(input: AutomationCreateInput, id: AutomationIdType, now: number): AutomationRecord {
  const candidate: unknown = input
  if (candidate === null || typeof candidate !== 'object') {
    throw new AutomationInputError('input must be an object')
  }
  const title = requiredString(input.title, 'title')
  const prompt = requiredString(input.prompt, 'prompt')
  const trigger = validateTrigger(input.trigger, now)
  const action = validateAction(input.action)
  const model = validateModel(input.model)
  return {
    id,
    title,
    createdAt: now,
    trigger,
    action,
    lastRun: null,
    prompt,
    ...(model === undefined ? {} : { model }),
  }
}

/**
 * Validate one trigger input at creation time.
 * @param trigger - unvalidated trigger input.
 * @param now - creation instant; `once` must target the future and `every` anchors here.
 * @throws {@link AutomationInputError} when the trigger is malformed or too dense.
 */
function validateTrigger(trigger: AutomationTriggerInput, now: number): AutomationTrigger {
  const candidate: unknown = trigger
  if (candidate === null || typeof candidate !== 'object') {
    throw new AutomationInputError('trigger must be an object')
  }
  const record = candidate as Record<string, unknown>
  switch (record['kind']) {
    case 'once': {
      const at = record['at']
      if (typeof at !== 'number' || !Number.isSafeInteger(at)) {
        throw new AutomationInputError('trigger.at must be a safe-integer epoch millisecond instant')
      }
      if (at <= now) throw new AutomationInputError('trigger.at must target a future instant')
      return { kind: 'once', at }
    }
    case 'every': {
      const intervalSeconds = record['intervalSeconds']
      if (typeof intervalSeconds !== 'number'
        || !Number.isSafeInteger(intervalSeconds)
        || intervalSeconds < MIN_TRIGGER_INTERVAL_SECONDS) {
        throw new AutomationInputError(`trigger.intervalSeconds must be a safe integer of at least ${MIN_TRIGGER_INTERVAL_SECONDS}`)
      }
      return { kind: 'every', anchorAt: now, intervalSeconds }
    }
    case 'cron': {
      const expression = requiredString(record['expression'], 'trigger.expression')
      const timeZone = record['timeZone']
      if (timeZone !== undefined && (typeof timeZone !== 'string' || timeZone.trim() === '')) {
        throw new AutomationInputError('trigger.timeZone must be a non-empty IANA zone when present')
      }
      let first: number | null
      try {
        first = cronNextAt({ kind: 'cron', expression, ...(timeZone === undefined ? {} : { timeZone }) }, now)
      } catch (error: unknown) {
        /* v8 ignore next -- croner rejects invalid patterns with Error instances; this keeps the message total otherwise. */
        const reason = error instanceof Error ? error.message : String(error)
        throw new AutomationInputError(`trigger.expression is not a valid cron expression: ${reason}`)
      }
      if (first === null) throw new AutomationInputError('trigger.expression has no future occurrence')
      const second = cronNextAt({ kind: 'cron', expression, ...(timeZone === undefined ? {} : { timeZone }) }, first)
      if (second !== null && second - first < MIN_TRIGGER_INTERVAL_SECONDS * 1000) {
        throw new AutomationInputError(`trigger.expression fires more often than every ${MIN_TRIGGER_INTERVAL_SECONDS} seconds`)
      }
      return { kind: 'cron', expression, ...(timeZone === undefined ? {} : { timeZone }) }
    }
    default:
      throw new AutomationInputError('trigger.kind must be one of "once", "every", "cron"')
  }
}

/**
 * Validate one action at creation time.
 * @param action - unvalidated action.
 * @throws {@link AutomationInputError} when the action is malformed.
 */
function validateAction(action: AutomationCreateInput['action']): AutomationRecord['action'] {
  const candidate: unknown = action
  if (candidate === null || typeof candidate !== 'object') {
    throw new AutomationInputError('action must be an object')
  }
  const record = candidate as Record<string, unknown>
  switch (record['kind']) {
    case 'new-session': {
      const cwd = requiredString(record['cwd'], 'action.cwd')
      if (!isAbsolute(cwd)) {
        throw new AutomationInputError(`action.cwd must be absolute, got ${JSON.stringify(cwd)}`)
      }
      return { kind: 'new-session', cwd }
    }
    case 'resume-session':
      return { kind: 'resume-session', sessionId: requiredString(record['sessionId'], 'action.sessionId') }
    default:
      throw new AutomationInputError('action.kind must be one of "new-session", "resume-session"')
  }
}

/**
 * Validate one optional model selection.
 * @param model - unvalidated selection.
 * @throws {@link AutomationInputError} when the selection is malformed.
 */
function validateModel(model: AutomationCreateInput['model']): AutomationRecord['model'] {
  if (model === undefined) return undefined
  const candidate: unknown = model
  if (candidate === null || typeof candidate !== 'object') {
    throw new AutomationInputError('model must be an object')
  }
  const record = candidate as Record<string, unknown>
  const provider = requiredString(record['provider'], 'model.provider')
  const modelId = requiredString(record['model'], 'model.model')
  const maxTokens = record['maxTokens']
  if (maxTokens !== undefined
    && (typeof maxTokens !== 'number' || !Number.isSafeInteger(maxTokens) || maxTokens <= 0)) {
    throw new AutomationInputError('model.maxTokens must be a positive safe integer')
  }
  return { provider, model: modelId, ...(maxTokens === undefined ? {} : { maxTokens }) }
}

/**
 * Derive the next due instant for one record.
 * @param record - the record to schedule.
 * @returns the next due instant in epoch milliseconds, or `null` when the record
 * never runs again (a fired `once`, or an exhausted cron).
 */
export function nextDueAt(record: AutomationRecord): number | null {
  switch (record.trigger.kind) {
    case 'once':
      return record.lastRun === null ? record.trigger.at : null
    case 'every': {
      const { anchorAt, intervalSeconds } = record.trigger
      const intervalMs = intervalSeconds * 1000
      // Before the first run the anchor occurrence itself is due; afterwards the
      // smallest occurrence strictly after the latest settlement wins, so a long
      // gap costs at most one catch-up run and then re-aligns.
      const base = record.lastRun?.finishedAt ?? anchorAt - 1
      const intervals = Math.max(0, Math.ceil((base + 1 - anchorAt) / intervalMs))
      return anchorAt + intervals * intervalMs
    }
    case 'cron':
      return cronNextAt(record.trigger, record.lastRun?.finishedAt ?? record.createdAt)
  }
}

/**
 * Apply one settled run to a record.
 * @param record - the record that just ran.
 * @param run - the settled run summary.
 * @returns the successor record; the caller persists it.
 */
export function applyRunOutcome(record: AutomationRecord, run: AutomationRunSummary): AutomationRecord {
  return { ...record, lastRun: run }
}

/**
 * Decode one durable record read back from the store file.
 * @param value - unvalidated JSON value.
 * @returns the validated record.
 * @throws {@link TypeError} when the value is not one well-formed record.
 */
export function decodeAutomationRecord(value: unknown): AutomationRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('automation store entry must be an object')
  }
  const record = value as Record<string, unknown>
  const title = requiredDurableString(record['title'], 'title')
  const prompt = requiredDurableString(record['prompt'], 'prompt')
  if (typeof record['id'] !== 'string' || record['id'].trim() === '') {
    throw new TypeError('automation store entry id must be a non-empty string')
  }
  if (!Number.isSafeInteger(record['createdAt']) || (record['createdAt'] as number) < 0) {
    throw new TypeError('automation store entry createdAt must be a non-negative safe integer')
  }
  const trigger = decodeTrigger(record['trigger'])
  const action = decodeAction(record['action'])
  const model = record['model'] === undefined ? undefined : decodeModel(record['model'])
  return {
    id: AutomationId(record['id']),
    title,
    createdAt: record['createdAt'] as number,
    trigger,
    action,
    lastRun: record['lastRun'] === null ? null : decodeRun(record['lastRun']),
    prompt,
    ...(model === undefined ? {} : { model }),
  }
}

/** Durability decode variant of {@link requiredString}; every failure is a `TypeError`. */
function requiredDurableString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`automation store entry ${field} must be a non-empty string`)
  }
  return value
}

/** Decode one durable trigger; validated like creation but without the future-`once` rule. */
function decodeTrigger(value: unknown): AutomationTrigger {
  if (value === null || typeof value !== 'object') {
    throw new TypeError('automation store entry trigger must be an object')
  }
  const record = value as Record<string, unknown>
  switch (record['kind']) {
    case 'once': {
      if (!Number.isSafeInteger(record['at'])) throw new TypeError('automation trigger at must be a safe integer')
      return { kind: 'once', at: record['at'] as number }
    }
    case 'every': {
      if (!Number.isSafeInteger(record['anchorAt'])) throw new TypeError('automation trigger anchorAt must be a safe integer')
      const intervalSeconds = record['intervalSeconds']
      if (typeof intervalSeconds !== 'number'
        || !Number.isSafeInteger(intervalSeconds)
        || intervalSeconds < MIN_TRIGGER_INTERVAL_SECONDS) {
        throw new TypeError('automation trigger intervalSeconds must be a safe integer of at least MIN_TRIGGER_INTERVAL_SECONDS')
      }
      return { kind: 'every', anchorAt: record['anchorAt'] as number, intervalSeconds }
    }
    case 'cron': {
      const expression = requiredDurableString(record['expression'], 'trigger expression')
      const timeZone = record['timeZone']
      if (timeZone !== undefined && typeof timeZone !== 'string') {
        throw new TypeError('automation trigger timeZone must be a string when present')
      }
      return { kind: 'cron', expression, ...(timeZone === undefined ? {} : { timeZone }) }
    }
    default:
      throw new TypeError('automation store entry trigger.kind is unknown')
  }
}

/** Decode one durable action. */
function decodeAction(value: unknown): AutomationRecord['action'] {
  if (value === null || typeof value !== 'object') {
    throw new TypeError('automation store entry action must be an object')
  }
  const record = value as Record<string, unknown>
  switch (record['kind']) {
    case 'new-session': {
      const cwd = requiredDurableString(record['cwd'], 'action cwd')
      if (!isAbsolute(cwd)) throw new TypeError('automation action cwd must be absolute')
      return { kind: 'new-session', cwd }
    }
    case 'resume-session':
      return { kind: 'resume-session', sessionId: requiredDurableString(record['sessionId'], 'action sessionId') }
    default:
      throw new TypeError('automation store entry action.kind is unknown')
  }
}

/** Decode one durable model selection. */
function decodeModel(value: unknown): NonNullable<AutomationRecord['model']> {
  if (value === null || typeof value !== 'object') {
    throw new TypeError('automation store entry model must be an object')
  }
  const record = value as Record<string, unknown>
  const provider = requiredDurableString(record['provider'], 'model provider')
  const model = requiredDurableString(record['model'], 'model model')
  const maxTokens = record['maxTokens']
  if (maxTokens !== undefined
    && (typeof maxTokens !== 'number' || !Number.isSafeInteger(maxTokens) || maxTokens <= 0)) {
    throw new TypeError('automation model maxTokens must be a positive safe integer')
  }
  return { provider, model, ...(maxTokens === undefined ? {} : { maxTokens }) }
}

/** Decode one durable run summary. */
function decodeRun(value: unknown): AutomationRunSummary {
  if (value === null || typeof value !== 'object') {
    throw new TypeError('automation store entry lastRun must be an object')
  }
  const record = value as Record<string, unknown>
  for (const field of ['startedAt', 'finishedAt'] as const) {
    if (!Number.isSafeInteger(record[field]) || (record[field] as number) < 0) {
      throw new TypeError(`automation run ${field} must be a non-negative safe integer`)
    }
  }
  if (record['outcome'] !== 'completed' && record['outcome'] !== 'error') {
    throw new TypeError('automation run outcome must be "completed" or "error"')
  }
  const detail = record['detail']
  if (detail !== undefined && typeof detail !== 'string') {
    throw new TypeError('automation run detail must be a string when present')
  }
  return {
    startedAt: record['startedAt'] as number,
    finishedAt: record['finishedAt'] as number,
    outcome: record['outcome'],
    ...(detail === undefined ? {} : { detail }),
  }
}
