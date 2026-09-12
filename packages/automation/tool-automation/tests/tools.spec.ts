/** Model-facing automation tools: trigger selection, action defaults, and error mapping. */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { AutomationId } from '@deepseek-ai/dsh-automation'
import { AutomationInputError } from '@deepseek-ai/dsh-automation'
import type { AutomationRuntime } from '@deepseek-ai/dsh-automation'
import { createAutomationRecord } from '@deepseek-ai/dsh-automation'
import { apply as applyToolAutomation, automationErrorValue, registerAutomationTools } from '../src/index.ts'

/** What the fake runtime observed. */
interface Observed {
  creates: Array<Record<string, unknown>>
  deleted: string[]
  listed: number
}

/** The default record a successful fake returns. */
function sampleRecord(): ReturnType<typeof createAutomationRecord> {
  return createAutomationRecord({
    title: 'nightly report',
    prompt: 'Summarize today.',
    trigger: { kind: 'cron', expression: '*/5 * * * *', timeZone: 'UTC' },
    action: { kind: 'new-session', cwd: '/tmp' },
  }, AutomationId('automation-x1'), Date.parse('2026-09-12T10:00:00Z'))
}

/**
 * A minimal AutomationRuntime stand-in; only the tool-called surface runs.
 * @param observed - observation sink.
 * @param mode - `'fail'` rejects every call; otherwise the records `list` returns.
 */
function fakeRuntime(observed: Observed, mode: 'fail' | readonly ReturnType<typeof createAutomationRecord>[] = 'fail'): AutomationRuntime {
  const sample = sampleRecord()
  return {
    create: async (input: Record<string, unknown>) => {
      observed.creates.push(input)
      if (mode === 'fail') throw new AutomationInputError('rejected by the fake')
      return sample
    },
    list: async () => {
      observed.listed += 1
      if (mode === 'fail') throw new Error('wiring failure')
      return mode
    },
    delete: async (id: string) => {
      observed.deleted.push(id)
      if (mode === 'fail') throw new Error('wiring failure')
      return true
    },
  } as unknown as AutomationRuntime
}

/** One record factory for view-shape assertions. */
function viewRecord(
  trigger: Record<string, unknown>,
  action: Record<string, unknown>,
  lastRun: unknown,
): ReturnType<typeof createAutomationRecord> {
  const record = createAutomationRecord({
    title: 'view',
    prompt: 'p',
    trigger: trigger as never,
    action: action as never,
  }, AutomationId('automation-view'), Date.parse('2026-09-12T10:00:00Z'))
  return lastRun === null ? record : { ...record, lastRun } as typeof record
}

/** One captured tool definition. */
interface ToolStub {
  execute: (args: Record<string, unknown>) => Promise<unknown>
  render: (args: unknown, value: unknown) => unknown
}

/** The definition shape the fake registry accepts. */
interface RegisteredTool extends ToolStub {
  name: string
  output: { render: ToolStub['render'] }
}

/** Register the tools against a fake registry and return them by name. */
function captureTools(runtime: AutomationRuntime): Map<string, ToolStub> {
  const registered = new Map<string, ToolStub>()
  const ctx = new Context()
  Object.defineProperty(ctx, 'tools', {
    value: {
      register: (definition: RegisteredTool) => {
        registered.set(definition.name, { execute: definition.execute, render: definition.output.render })
        return () => registered.delete(definition.name)
      },
    },
  })
  registerAutomationTools(ctx, runtime, () => '/default/cwd')
  return registered
}

describe('automation_create', () => {
  it('maps a cron trigger with a time zone through to the service', async () => {
    const observed: Observed = { creates: [], deleted: [], listed: 0 }
    const tools = captureTools(fakeRuntime(observed, [sampleRecord()]))
    const value = await tools.get('automation_create')!.execute({
      title: 'standup',
      prompt: 'Write the standup notes.',
      cron: '30 9 * * mon-fri',
      time_zone: 'Asia/Shanghai',
    }) as { automation: Record<string, unknown> }
    expect(observed.creates[0]).toMatchObject({
      title: 'standup',
      prompt: 'Write the standup notes.',
      trigger: { kind: 'cron', expression: '30 9 * * mon-fri', timeZone: 'Asia/Shanghai' },
      action: { kind: 'new-session', cwd: '/default/cwd' },
    })
    expect(value.automation).toMatchObject({ id: 'automation-x1', trigger: { kind: 'cron', expression: '*/5 * * * *' } })
    expect(value.automation['nextDueAt']).toBeTypeOf('string')
  })

  it('maps at and every_seconds triggers and rejects ambiguous or malformed selections', async () => {
    const observed: Observed = { creates: [], deleted: [], listed: 0 }
    const tools = captureTools(fakeRuntime(observed, [sampleRecord()]))
    await tools.get('automation_create')!.execute({ title: 't', prompt: 'p', at: '2030-01-01T00:00:00Z' })
    expect(observed.creates[0]).toMatchObject({ trigger: { kind: 'once', at: Date.parse('2030-01-01T00:00:00Z') } })

    await tools.get('automation_create')!.execute({ title: 't', prompt: 'p', every_seconds: 300 })
    expect(observed.creates[1]).toMatchObject({ trigger: { kind: 'every', intervalSeconds: 300 } })

    const neither = await tools.get('automation_create')!.execute({ title: 't', prompt: 'p' }) as { code: string }
    expect(neither.code).toBe('invalid_input')
    const both = await tools.get('automation_create')!.execute({ title: 't', prompt: 'p', at: '2030-01-01T00:00:00Z', every_seconds: 300 }) as { code: string }
    expect(both.code).toBe('invalid_input')
    const badDate = await tools.get('automation_create')!.execute({ title: 't', prompt: 'p', at: 'tomorrow' }) as { code: string }
    expect(badDate.code).toBe('invalid_input')
    const zoneOnOnce = await tools.get('automation_create')!.execute({ title: 't', prompt: 'p', at: '2030-01-01T00:00:00Z', time_zone: 'UTC' }) as { code: string }
    expect(zoneOnOnce.code).toBe('invalid_input')
    const zoneOnEvery = await tools.get('automation_create')!.execute({ title: 't', prompt: 'p', every_seconds: 300, time_zone: 'UTC' }) as { code: string }
    expect(zoneOnEvery.code).toBe('invalid_input')
  })

  it('prefers an explicit session target, then an explicit cwd, then the default', async () => {
    const observed: Observed = { creates: [], deleted: [], listed: 0 }
    const tools = captureTools(fakeRuntime(observed, [sampleRecord()]))
    await tools.get('automation_create')!.execute({ title: 't', prompt: 'p', every_seconds: 300, session_id: 'session-7' })
    expect(observed.creates[0]).toMatchObject({ action: { kind: 'resume-session', sessionId: 'session-7' } })
    await tools.get('automation_create')!.execute({ title: 't', prompt: 'p', every_seconds: 300, cwd: '/explicit' })
    expect(observed.creates[1]).toMatchObject({ action: { kind: 'new-session', cwd: '/explicit' } })
    await tools.get('automation_create')!.execute({ title: 't', prompt: 'p', every_seconds: 300 })
    expect(observed.creates[2]).toMatchObject({ action: { kind: 'new-session', cwd: '/default/cwd' } })
  })

  it('maps service rejections onto the invalid_input error value', async () => {
    const observed: Observed = { creates: [], deleted: [], listed: 0 }
    const tools = captureTools(fakeRuntime(observed))
    const value = await tools.get('automation_create')!.execute({ title: 't', prompt: 'p', every_seconds: 300 }) as { code: string; message: string }
    expect(value).toMatchObject({ code: 'invalid_input', message: 'rejected by the fake' })
  })
})

describe('automation_list and automation_delete', () => {
  it('project records and deletions', async () => {
    const observed: Observed = { creates: [], deleted: [], listed: 0 }
    const tools = captureTools(fakeRuntime(observed, [sampleRecord()]))
    const listed = await tools.get('automation_list')!.execute({}) as { automations: Array<Record<string, unknown>> }
    expect(observed.listed).toBe(1)
    expect(listed.automations).toHaveLength(1)
    expect(listed.automations[0]).toMatchObject({ id: 'automation-x1', prompt: 'Summarize today.', action: { kind: 'new-session', cwd: '/tmp' } })

    const deleted = await tools.get('automation_delete')!.execute({ id: 'automation-x1' }) as { id: string; deleted: boolean }
    expect(deleted).toEqual({ id: 'automation-x1', deleted: true })
    expect(observed.deleted).toEqual(['automation-x1'])
  })

  it('projects every trigger, action, and run shape', async () => {
    const observed: Observed = { creates: [], deleted: [], listed: 0 }
    const records = [
      viewRecord({ kind: 'once', at: Date.parse('2030-01-01T00:00:00Z') }, { kind: 'resume-session', sessionId: 'session-4' }, {
        startedAt: 1,
        finishedAt: 2,
        outcome: 'error',
        detail: 'went wrong',
      }),
      viewRecord({ kind: 'every', intervalSeconds: 300 }, { kind: 'new-session', cwd: '/tmp' }, {
        startedAt: 1,
        finishedAt: 2,
        outcome: 'completed',
      }),
      viewRecord({ kind: 'cron', expression: '0 9 * * *' }, { kind: 'new-session', cwd: '/tmp' }, null),
    ]
    const tools = captureTools(fakeRuntime(observed, records))
    const listed = await tools.get('automation_list')!.execute({}) as { automations: Array<Record<string, unknown>> }
    expect(listed.automations[0]).toMatchObject({
      trigger: { kind: 'once', at: '2030-01-01T00:00:00.000Z' },
      action: { kind: 'resume-session', sessionId: 'session-4' },
      lastRun: { outcome: 'error', detail: 'went wrong' },
      nextDueAt: null,
    })
    expect(listed.automations[1]).toMatchObject({
      trigger: { kind: 'every', intervalSeconds: 300 },
      action: { kind: 'new-session', cwd: '/tmp' },
      lastRun: { outcome: 'completed' },
      nextDueAt: '2026-09-12T10:00:00.000Z',
    })
    expect(listed.automations[1]!['lastRun']).not.toHaveProperty('detail')
    expect(listed.automations[2]).toMatchObject({ trigger: { kind: 'cron', expression: '0 9 * * *' } })
    expect(listed.automations[2]!['trigger']).not.toHaveProperty('timeZone')
  })

  it('renders canonical values as one JSON text block', () => {
    const observed: Observed = { creates: [], deleted: [], listed: 0 }
    const tools = captureTools(fakeRuntime(observed, [sampleRecord()]))
    const rendered = tools.get('automation_list')!.render({}, { hello: 'world' }) as Array<{ type: string; text: string }>
    expect(rendered).toEqual([{ type: 'text', text: '{"hello":"world"}' }])
  })

  it('maps a cron trigger without a time zone', async () => {
    const observed: Observed = { creates: [], deleted: [], listed: 0 }
    const tools = captureTools(fakeRuntime(observed, [sampleRecord()]))
    await tools.get('automation_create')!.execute({ title: 't', prompt: 'p', cron: '0 9 * * *' })
    expect(observed.creates[0]).toMatchObject({ trigger: { kind: 'cron', expression: '0 9 * * *' } })
  })

  it('map wiring failures onto internal_error', async () => {
    const observed: Observed = { creates: [], deleted: [], listed: 0 }
    const tools = captureTools(fakeRuntime(observed))
    expect(await tools.get('automation_list')!.execute({})).toMatchObject({ code: 'internal_error' })
    expect(await tools.get('automation_delete')!.execute({ id: 'x' })).toMatchObject({ code: 'internal_error' })
  })
})

describe('automationErrorValue mapping', () => {
  it('keeps input errors and maps everything else to internal_error', () => {
    expect(automationErrorValue(new AutomationInputError('bad'))).toEqual({ code: 'invalid_input', message: 'bad' })
    expect(automationErrorValue(new Error('boom'))).toEqual({ code: 'internal_error', message: 'boom' })
    expect(automationErrorValue(42)).toEqual({ code: 'internal_error', message: '42' })
  })
})

describe('tool-automation plugin wiring', () => {
  it('registers the three tools and defaults the action cwd to the process directory', async () => {
    const observed: Observed = { creates: [], deleted: [], listed: 0 }
    const registered = new Map<string, { name: string; execute: (args: Record<string, unknown>) => Promise<unknown> }>()
    const ctx = new Context()
    Object.defineProperty(ctx, 'tools', {
      value: {
        register: (definition: { name: string; execute: (args: Record<string, unknown>) => Promise<unknown> }) => {
          registered.set(definition.name, definition)
          return () => {}
        },
      },
    })
    Object.defineProperty(ctx, 'automation', { value: fakeRuntime(observed, [sampleRecord()]) })
    applyToolAutomation(ctx)
    expect([...registered.keys()]).toEqual(['automation_create', 'automation_list', 'automation_delete'])

    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue('/process/cwd')
    try {
      await registered.get('automation_create')!.execute({ title: 't', prompt: 'p', every_seconds: 300 })
      expect(observed.creates[0]).toMatchObject({ action: { kind: 'new-session', cwd: '/process/cwd' } })
    } finally {
      cwdSpy.mockRestore()
    }
  })
})
