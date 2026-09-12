/** Pure trigger math, validation, and durable-record decoding. */

import { describe, expect, it } from 'vitest'
import { AutomationId } from '../src/brand.ts'
import {
  applyRunOutcome,
  AutomationInputError,
  createAutomationRecord,
  cronNextAt,
  decodeAutomationRecord,
  nextDueAt,
} from '../src/domain.ts'
import type { AutomationRecord } from '../src/types.ts'

const NOW = Date.parse('2026-09-12T10:00:00Z')

/** One valid create input, customized per case. */
function input(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: 'nightly report',
    prompt: 'Summarize today.',
    trigger: { kind: 'once', at: NOW + 60_000 },
    action: { kind: 'new-session', cwd: '/tmp' },
    ...overrides,
  }
}

describe('createAutomationRecord', () => {
  it('materializes a once record with no runs', () => {
    const record = createAutomationRecord(input() as never, AutomationId('a1'), NOW)
    expect(record).toMatchObject({
      id: 'a1',
      title: 'nightly report',
      createdAt: NOW,
      trigger: { kind: 'once', at: NOW + 60_000 },
      action: { kind: 'new-session', cwd: '/tmp' },
      lastRun: null,
      prompt: 'Summarize today.',
    })
    expect(record.model).toBeUndefined()
  })

  it('anchors an every trigger at creation', () => {
    const record = createAutomationRecord(
      input({ trigger: { kind: 'every', intervalSeconds: 300 } }) as never,
      AutomationId('a2'),
      NOW,
    )
    expect(record.trigger).toEqual({ kind: 'every', anchorAt: NOW, intervalSeconds: 300 })
  })

  it('keeps an explicit model selection', () => {
    const record = createAutomationRecord(
      input({ model: { provider: 'deepseek-official', model: 'deepseek-v4-flash', maxTokens: 1024 } }) as never,
      AutomationId('a3'),
      NOW,
    )
    expect(record.model).toEqual({ provider: 'deepseek-official', model: 'deepseek-v4-flash', maxTokens: 1024 })
  })

  it('rejects a once trigger that does not target the future', () => {
    expect(() => createAutomationRecord(input({ trigger: { kind: 'once', at: NOW } }) as never, AutomationId('a'), NOW))
      .toThrow(AutomationInputError)
    expect(() => createAutomationRecord(input({ trigger: { kind: 'once', at: 'soon' } }) as never, AutomationId('a'), NOW))
      .toThrow(/trigger\.at/)
  })

  it('rejects every intervals below the floor and non-integer values', () => {
    expect(() => createAutomationRecord(input({ trigger: { kind: 'every', intervalSeconds: 299 } }) as never, AutomationId('a'), NOW))
      .toThrow(/intervalSeconds/)
    expect(() => createAutomationRecord(input({ trigger: { kind: 'every', intervalSeconds: 1.5 } }) as never, AutomationId('a'), NOW))
      .toThrow(/intervalSeconds/)
  })

  it('rejects malformed cron expressions, impossible schedules, and dense patterns', () => {
    expect(() => createAutomationRecord(input({ trigger: { kind: 'cron', expression: 'not a cron' } }) as never, AutomationId('a'), NOW))
      .toThrow(/not a valid cron/)
    expect(() => createAutomationRecord(input({ trigger: { kind: 'cron', expression: '0 0 31 2 *' } }) as never, AutomationId('a'), NOW))
      .toThrow(/no future occurrence/)
    expect(() => createAutomationRecord(input({ trigger: { kind: 'cron', expression: '* * * * *' } }) as never, AutomationId('a'), NOW))
      .toThrow(/more often than every/)
  })

  it('accepts a cron expression at exactly the interval floor', () => {
    const record = createAutomationRecord(
      input({ trigger: { kind: 'cron', expression: '*/5 * * * *', timeZone: 'UTC' } }) as never,
      AutomationId('a4'),
      NOW,
    )
    expect(record.trigger).toEqual({ kind: 'cron', expression: '*/5 * * * *', timeZone: 'UTC' })
  })

  it('rejects an empty cron time zone', () => {
    expect(() => createAutomationRecord(input({ trigger: { kind: 'cron', expression: '*/5 * * * *', timeZone: '  ' } }) as never, AutomationId('a'), NOW))
      .toThrow(/timeZone/)
  })

  it('rejects non-absolute new-session directories and bad actions', () => {
    expect(() => createAutomationRecord(input({ action: { kind: 'new-session', cwd: 'relative' } }) as never, AutomationId('a'), NOW))
      .toThrow(/absolute/)
    expect(() => createAutomationRecord(input({ action: { kind: 'resume-session' } }) as never, AutomationId('a'), NOW))
      .toThrow(/sessionId/)
    expect(() => createAutomationRecord(input({ action: { kind: 'explode' } }) as never, AutomationId('a'), NOW))
      .toThrow(/action\.kind/)
  })

  it('rejects empty labels, prompts, non-object input, and bad models', () => {
    expect(() => createAutomationRecord(input({ title: '' }) as never, AutomationId('a'), NOW)).toThrow(/title/)
    expect(() => createAutomationRecord(input({ prompt: ' ' }) as never, AutomationId('a'), NOW)).toThrow(/prompt/)
    expect(() => createAutomationRecord(null as never, AutomationId('a'), NOW)).toThrow(/object/)
    expect(() => createAutomationRecord(input({ trigger: null }) as never, AutomationId('a'), NOW)).toThrow(/trigger/)
    expect(() => createAutomationRecord(input({ action: null }) as never, AutomationId('a'), NOW)).toThrow(/action/)
    expect(() => createAutomationRecord(input({ model: 'fast' }) as never, AutomationId('a'), NOW)).toThrow(/model/)
    expect(() => createAutomationRecord(input({ model: { provider: '', model: 'm' } }) as never, AutomationId('a'), NOW))
      .toThrow(/model\.provider/)
    expect(() => createAutomationRecord(input({ model: { provider: 'p', model: 'm', maxTokens: 0 } }) as never, AutomationId('a'), NOW))
      .toThrow(/maxTokens/)
  })

  it('rejects an unknown trigger kind', () => {
    expect(() => createAutomationRecord(input({ trigger: { kind: 'sometimes' } }) as never, AutomationId('a'), NOW))
      .toThrow(/trigger\.kind/)
  })

  it('accepts a cron expression without a time zone and a model without an output cap', () => {
    const cronless = createAutomationRecord(input({ trigger: { kind: 'cron', expression: '*/10 * * * *' } }) as never, AutomationId('a'), NOW)
    expect(cronless.trigger).toEqual({ kind: 'cron', expression: '*/10 * * * *' })
    const uncapped = createAutomationRecord(input({ model: { provider: 'p', model: 'm' } }) as never, AutomationId('b'), NOW)
    expect(uncapped.model).toEqual({ provider: 'p', model: 'm' })
  })
})

describe('nextDueAt', () => {
  it('returns the stored instant for an un-run once record and null after its run', () => {
    const record = createAutomationRecord(input() as never, AutomationId('a'), NOW)
    expect(nextDueAt(record)).toBe(NOW + 60_000)
    const ran = applyRunOutcome(record, { startedAt: NOW, finishedAt: NOW + 1000, outcome: 'completed' })
    expect(nextDueAt(ran)).toBeNull()
  })

  it('returns the anchor before the first run and the next occurrence after one', () => {
    const record = createAutomationRecord(
      input({ trigger: { kind: 'every', intervalSeconds: 300 } }) as never,
      AutomationId('a'),
      NOW,
    )
    expect(nextDueAt(record)).toBe(NOW)
    const ran = applyRunOutcome(record, { startedAt: NOW, finishedAt: NOW + 200_000, outcome: 'completed' })
    expect(nextDueAt(ran)).toBe(NOW + 300_000)
    const ranLate = applyRunOutcome(record, { startedAt: NOW, finishedAt: NOW + 650_000, outcome: 'completed' })
    expect(nextDueAt(ranLate)).toBe(NOW + 900_000)
  })

  it('derives the next cron occurrence after the latest settlement', () => {
    const record = createAutomationRecord(
      input({ trigger: { kind: 'cron', expression: '*/5 * * * *' } }) as never,
      AutomationId('a'),
      NOW,
    )
    expect(nextDueAt(record)).toBe(Date.parse('2026-09-12T10:05:00Z'))
    const ran = applyRunOutcome(record, { startedAt: NOW, finishedAt: Date.parse('2026-09-12T10:06:30Z'), outcome: 'completed' })
    expect(nextDueAt(ran)).toBe(Date.parse('2026-09-12T10:10:00Z'))
  })
})

describe('cronNextAt', () => {
  it('evaluates the expression in the configured time zone', () => {
    const trigger = { kind: 'cron' as const, expression: '30 9 * * mon-fri', timeZone: 'America/New_York' }
    expect(cronNextAt(trigger, Date.parse('2026-09-12T10:00:00Z'))).toBe(Date.parse('2026-09-14T13:30:00Z'))
  })

  it('returns null for an expression with no future occurrence', () => {
    expect(cronNextAt({ kind: 'cron', expression: '0 0 31 2 *' }, NOW)).toBeNull()
  })
})

describe('applyRunOutcome', () => {
  it('replaces the latest run and keeps everything else', () => {
    const record: AutomationRecord = createAutomationRecord(input() as never, AutomationId('a'), NOW)
    const run = { startedAt: NOW + 1, finishedAt: NOW + 2, outcome: 'error' as const, detail: 'boom' }
    expect(applyRunOutcome(record, run)).toEqual({ ...record, lastRun: run })
  })
})

describe('decodeAutomationRecord', () => {
  /** One fully populated durable record. */
  function stored(): Record<string, unknown> {
    return JSON.parse(JSON.stringify(createAutomationRecord(
      input({
        trigger: { kind: 'cron', expression: '*/5 * * * *', timeZone: 'UTC' },
        model: { provider: 'p', model: 'm', maxTokens: 8 },
      }) as never,
      AutomationId('a9'),
      NOW,
    ))) as Record<string, unknown>
  }

  it('round-trips a record through lossless JSON', () => {
    const decoded = decodeAutomationRecord(stored())
    expect(decoded).toEqual(createAutomationRecord(
      input({
        trigger: { kind: 'cron', expression: '*/5 * * * *', timeZone: 'UTC' },
        model: { provider: 'p', model: 'm', maxTokens: 8 },
      }) as never,
      AutomationId('a9'),
      NOW,
    ))
  })

  it('decodes a record with a settled run', () => {
    const value = stored()
    value['lastRun'] = { startedAt: 1, finishedAt: 2, outcome: 'error', detail: 'x' }
    expect(decodeAutomationRecord(value).lastRun).toEqual({ startedAt: 1, finishedAt: 2, outcome: 'error', detail: 'x' })
    const detailless = stored()
    detailless['lastRun'] = { startedAt: 1, finishedAt: 2, outcome: 'completed' }
    expect(decodeAutomationRecord(detailless).lastRun).toEqual({ startedAt: 1, finishedAt: 2, outcome: 'completed' })
  })

  it('decodes every trigger shape without optional fields', () => {
    const once = stored()
    once['trigger'] = { kind: 'once', at: 5 }
    expect(decodeAutomationRecord(once).trigger).toEqual({ kind: 'once', at: 5 })
    const every = stored()
    every['trigger'] = { kind: 'every', anchorAt: 5, intervalSeconds: 300 }
    every['action'] = { kind: 'resume-session', sessionId: 'session-9' }
    every['model'] = { provider: 'p', model: 'm' }
    const decoded = decodeAutomationRecord(every)
    expect(decoded.trigger).toEqual({ kind: 'every', anchorAt: 5, intervalSeconds: 300 })
    expect(decoded.action).toEqual({ kind: 'resume-session', sessionId: 'session-9' })
    expect(decoded.model).toEqual({ provider: 'p', model: 'm' })
    const zoneless = stored()
    zoneless['trigger'] = { kind: 'cron', expression: '*/5 * * * *' }
    expect(decodeAutomationRecord(zoneless).trigger).toEqual({ kind: 'cron', expression: '*/5 * * * *' })
  })

  it('rejects every malformed durable field', () => {
    expect(() => decodeAutomationRecord('x')).toThrow(TypeError)
    expect(() => decodeAutomationRecord([1])).toThrow(TypeError)
    const cases: Array<[string, unknown]> = [
      ['title', null],
      ['prompt', ''],
      ['id', ''],
      ['createdAt', -1],
      ['trigger', null],
    ]
    for (const [field, replacement] of cases) {
      const value = stored()
      value[field] = replacement
      expect(() => decodeAutomationRecord(value), `${field} = ${JSON.stringify(replacement)}`).toThrow(TypeError)
    }
    const kind = stored()
    ;(kind['trigger'] as Record<string, unknown>)['kind'] = 'sometimes'
    expect(() => decodeAutomationRecord(kind)).toThrow(TypeError)
  })

  it('rejects malformed every intervals, cron zones, actions, models, and runs', () => {
    const every = stored()
    every['trigger'] = { kind: 'every', anchorAt: 5, intervalSeconds: 10 }
    expect(() => decodeAutomationRecord(every)).toThrow(/intervalSeconds/)

    const zone = stored()
    zone['trigger'] = { kind: 'cron', expression: '*/5 * * * *', timeZone: 7 }
    expect(() => decodeAutomationRecord(zone)).toThrow(/timeZone/)

    const anchor = stored()
    anchor['trigger'] = { kind: 'every', anchorAt: 'x', intervalSeconds: 300 }
    expect(() => decodeAutomationRecord(anchor)).toThrow(/anchorAt/)

    const action = stored()
    action['action'] = { kind: 'new-session', cwd: 'relative' }
    expect(() => decodeAutomationRecord(action)).toThrow(/absolute/)

    const resume = stored()
    resume['action'] = { kind: 'resume-session' }
    expect(() => decodeAutomationRecord(resume)).toThrow(/sessionId/)

    const model = stored()
    model['model'] = { provider: 'p', model: 'm', maxTokens: 0 }
    expect(() => decodeAutomationRecord(model)).toThrow(/maxTokens/)

    const modelShape = stored()
    modelShape['model'] = 'p'
    expect(() => decodeAutomationRecord(modelShape)).toThrow(/model/)

    const once = stored()
    once['trigger'] = { kind: 'once', at: 1.5 }
    expect(() => decodeAutomationRecord(once)).toThrow(/at/)

    const runOutcome = stored()
    runOutcome['lastRun'] = { startedAt: 1, finishedAt: 2, outcome: 'exploded' }
    expect(() => decodeAutomationRecord(runOutcome)).toThrow(/outcome/)

    const runTime = stored()
    runTime['lastRun'] = { startedAt: -1, finishedAt: 2, outcome: 'completed' }
    expect(() => decodeAutomationRecord(runTime)).toThrow(/startedAt/)

    const runDetail = stored()
    runDetail['lastRun'] = { startedAt: 1, finishedAt: 2, outcome: 'completed', detail: 3 }
    expect(() => decodeAutomationRecord(runDetail)).toThrow(/detail/)

    const runShape = stored()
    runShape['lastRun'] = 'done'
    expect(() => decodeAutomationRecord(runShape)).toThrow(/lastRun/)

    const actionShape = stored()
    actionShape['action'] = 'go'
    expect(() => decodeAutomationRecord(actionShape)).toThrow(/action/)

    const actionKind = stored()
    actionKind['action'] = { kind: 'explode' }
    expect(() => decodeAutomationRecord(actionKind)).toThrow(/action\.kind/)

    const triggerShape = stored()
    triggerShape['trigger'] = 'soon'
    expect(() => decodeAutomationRecord(triggerShape)).toThrow(/trigger/)
  })
})
