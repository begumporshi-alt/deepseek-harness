/**
 * Model-facing automation tools over `ctx.automation`: create, list, and
 * delete. Errors surface as schema'd error values, never as thrown tool
 * failures, so the model can correct its own input.
 * @module @deepseek-ai/dsh-tool-automation/src/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import { AutomationId, AutomationInputError, MIN_TRIGGER_INTERVAL_SECONDS, nextDueAt as nextDueOf } from '@deepseek-ai/dsh-automation'
import type { AutomationRuntime, AutomationRecord, AutomationTriggerInput } from '@deepseek-ai/dsh-automation'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { basicErrorSchema, defineTool, type InferValue } from '@deepseek-ai/dsh-tools'

/** JSON-schema view of one automation; timestamps render as ISO 8601 strings. */
const AUTOMATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    title: { type: 'string', required: true },
    prompt: { type: 'string', required: true },
    createdAt: { type: 'string', required: true },
    trigger: {
      required: true,
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: { type: 'string', required: true, const: 'once' },
            at: { type: 'string', required: true },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: { type: 'string', required: true, const: 'every' },
            intervalSeconds: { type: 'integer', required: true },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: { type: 'string', required: true, const: 'cron' },
            expression: { type: 'string', required: true },
            timeZone: { type: 'string' },
          },
        },
      ],
    },
    action: {
      required: true,
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: { type: 'string', required: true, const: 'new-session' },
            cwd: { type: 'string', required: true },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: { type: 'string', required: true, const: 'resume-session' },
            sessionId: { type: 'string', required: true },
          },
        },
      ],
    },
    nextDueAt: {
      required: true,
      oneOf: [
        { type: 'string' },
        { type: 'null' },
      ],
    },
    lastRun: {
      oneOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            startedAt: { type: 'string', required: true },
            finishedAt: { type: 'string', required: true },
            outcome: { type: 'string', required: true, enum: ['completed', 'error'] },
            detail: { type: 'string' },
          },
        },
      ],
    },
  },
} as const

/** JSON-schema view of the created-automation value. */
const CREATE_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { automation: AUTOMATION_SCHEMA },
} as const

/** JSON-schema view of the list value. */
const LIST_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { automations: { type: 'array', required: true, items: AUTOMATION_SCHEMA } },
} as const

/** JSON-schema view of the delete value. */
const DELETE_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    deleted: { type: 'boolean', required: true },
  },
} as const

/** Every tool-callable failure, schema'd for the model. */
const ERROR_SCHEMAS = [
  basicErrorSchema('invalid_input'),
  basicErrorSchema('not_found'),
  basicErrorSchema('internal_error'),
] as const

const CREATE_OUTPUT = { oneOf: [CREATE_OUTPUT_SCHEMA, ...ERROR_SCHEMAS] } as const
const LIST_OUTPUT = { oneOf: [LIST_OUTPUT_SCHEMA, ...ERROR_SCHEMAS] } as const
const DELETE_OUTPUT = { oneOf: [DELETE_OUTPUT_SCHEMA, ...ERROR_SCHEMAS] } as const

/** Model-facing description of `automation_create`. */
const CREATE_DESCRIPTION = 'Schedule one durable automation that runs a prompt on a timer, in a fresh session or by resuming an existing one. Use it for recurring work (daily reports, weekly reviews) or one future task; the schedule survives restarts. Exactly one trigger is required: `at`, `every_seconds`, or `cron` (with optional `time_zone`).'/** Model-facing description of `automation_list`. */
const LIST_DESCRIPTION = 'List every stored automation with its trigger, target, next due time, and latest run outcome.'

/** Model-facing description of `automation_delete`. */
const DELETE_DESCRIPTION = 'Delete one automation by its id, as returned by automation_create or automation_list.'

/** Deterministic model content for every canonical automation value. */
function renderValue(_args: unknown, value: unknown): ContentBlock[] {
  // The ToolRuntime has already validated the value against the lossless-JSON output schema.
  return [{ type: 'text', text: JSON.stringify(value) }]
}

/** ISO-string tool view of one record, shaped exactly as {@link AUTOMATION_SCHEMA} infers. */
function automationView(record: AutomationRecord): InferValue<typeof AUTOMATION_SCHEMA> {
  return {
    id: record.id,
    title: record.title,
    prompt: record.prompt,
    createdAt: new Date(record.createdAt).toISOString(),
    trigger: record.trigger.kind === 'once'
      ? { kind: 'once', at: new Date(record.trigger.at).toISOString() }
      : record.trigger.kind === 'every'
        ? { kind: 'every', intervalSeconds: record.trigger.intervalSeconds }
        : {
          kind: 'cron',
          expression: record.trigger.expression,
          ...(record.trigger.timeZone === undefined ? {} : { timeZone: record.trigger.timeZone }),
        },
    action: record.action.kind === 'new-session'
      ? { kind: 'new-session', cwd: record.action.cwd }
      : { kind: 'resume-session', sessionId: record.action.sessionId },
    nextDueAt: nextDueOf(record) === null ? null : new Date(nextDueOf(record) as number).toISOString(),
    lastRun: record.lastRun === null
      ? null
      : {
        startedAt: new Date(record.lastRun.startedAt).toISOString(),
        finishedAt: new Date(record.lastRun.finishedAt).toISOString(),
        outcome: record.lastRun.outcome,
        ...(record.lastRun.detail === undefined ? {} : { detail: record.lastRun.detail }),
      },
  }
}

/** Schema'd error value the automation tools return instead of throwing. */
type AutomationErrorValue = {
  readonly code: 'invalid_input' | 'not_found' | 'internal_error'
  readonly message: string
}

/**
 * Map one trigger input selection from flat tool arguments.
 * @param args - the validated tool arguments.
 * @returns the service-facing trigger, or an error value when the selection is
 * not exactly one recognized trigger.
 */
function triggerFromArgs(
  args: { at?: string; every_seconds?: number; cron?: string; time_zone?: string },
): { trigger: AutomationTriggerInput } | AutomationErrorValue {
  const selected = [args.at, args.every_seconds, args.cron].filter(value => value !== undefined)
  if (selected.length !== 1) {
    return { code: 'invalid_input', message: 'exactly one of at, every_seconds, or cron is required' }
  }
  if (args.at !== undefined) {
    const at = Date.parse(args.at)
    if (Number.isNaN(at)) return { code: 'invalid_input', message: 'at must be an ISO 8601 timestamp' }
    if (args.time_zone !== undefined) {
      return { code: 'invalid_input', message: 'time_zone applies to cron only; encode the zone in the at timestamp' }
    }
    return { trigger: { kind: 'once', at } }
  }
  if (args.every_seconds !== undefined) {
    if (args.time_zone !== undefined) {
      return { code: 'invalid_input', message: 'time_zone applies to cron only' }
    }
    return { trigger: { kind: 'every', intervalSeconds: args.every_seconds } }
  }
  return {
    trigger: {
      kind: 'cron',
      expression: args.cron as string,
      ...(args.time_zone === undefined ? {} : { timeZone: args.time_zone }),
    },
  }
}

/**
 * Register the three automation tools on the tool registry for the calling
 * fiber's lifetime; the registry disposes them with it.
 * @param ctx - Plugin context holding the tool registry.
 * @param automation - The automation runtime the tools operate on.
 * @param resolveDefaultCwd - Absolute directory used when the caller names no
 * action target; typically the calling agent's working directory.
 */
export function registerAutomationTools(
  ctx: Context,
  automation: AutomationRuntime,
  resolveDefaultCwd: () => string,
): void {
  ctx.tools.register(defineTool({
    name: 'automation_create',
    description: CREATE_DESCRIPTION,
    parameters: {
      title: {
        type: 'string',
        required: true,
        description: 'Short diagnostic label for the schedule.',
      },
      prompt: {
        type: 'string',
        required: true,
        description: 'The prompt submitted on every run, as self-contained prose a fresh session can act on.',
      },
      at: {
        type: 'string',
        description: 'One-shot ISO 8601 instant in the future, e.g. "2026-09-13T09:00:00+08:00".',
      },
      every_seconds: {
        type: 'number',
        description: `Fixed-rate interval in whole seconds, at least ${MIN_TRIGGER_INTERVAL_SECONDS}.`,
      },
      cron: {
        type: 'string',
        description: 'Cron expression such as "30 9 * * mon-fri" (optionally 6 fields with seconds).',
      },
      time_zone: {
        type: 'string',
        description: 'Optional IANA time zone for the cron expression, e.g. "Asia/Shanghai".',
      },
      cwd: {
        type: 'string',
        description: 'Absolute directory for a fresh session each run. Omit to use the current working directory.',
      },
      session_id: {
        type: 'string',
        description: 'Existing session id to resume and prompt on every run. Takes precedence over cwd.',
      },
    },
    output: { schema: CREATE_OUTPUT, render: renderValue },
    async execute(args) {
      const trigger = triggerFromArgs(args)
      if ('code' in trigger) return trigger
      const action = args.session_id !== undefined
        ? { kind: 'resume-session', sessionId: args.session_id } as const
        : args.cwd !== undefined
          ? { kind: 'new-session', cwd: args.cwd } as const
          : { kind: 'new-session', cwd: resolveDefaultCwd() } as const
      try {
        const record = await automation.create({
          title: args.title,
          prompt: args.prompt,
          trigger: trigger.trigger,
          action,
        })
        return { automation: automationView(record) }
      } catch (error: unknown) {
        return automationErrorValue(error)
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'automation_list',
    description: LIST_DESCRIPTION,
    parameters: {},
    output: { schema: LIST_OUTPUT, render: renderValue },
    async execute() {
      try {
        const records = await automation.list()
        return { automations: records.map(automationView) }
      } catch (error: unknown) {
        return automationErrorValue(error)
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'automation_delete',
    description: DELETE_DESCRIPTION,
    parameters: {
      id: {
        type: 'string',
        required: true,
        description: 'The id of the automation to remove.',
      },
    },
    output: { schema: DELETE_OUTPUT, render: renderValue },
    async execute(args) {
      try {
        const deleted = await automation.delete(AutomationId(args.id))
        return { id: args.id, deleted }
      } catch (error: unknown) {
        return automationErrorValue(error)
      }
    },
  }))
}

/**
 * Map a rejected automation operation onto the schema'd error vocabulary.
 * @param error - The rejection from the automation runtime.
 * @returns the schema'd error value.
 */
export function automationErrorValue(error: unknown): AutomationErrorValue {
  if (error instanceof AutomationInputError) {
    return { code: 'invalid_input', message: error.message }
  }
  return { code: 'internal_error', message: error instanceof Error ? error.message : String(error) }
}
