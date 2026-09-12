/** The run executor against stub contexts: outcome derivation, failure containment, and cleanup. */

import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { AutomationId } from '../src/brand.ts'
import { createAutomationRecord } from '../src/domain.ts'
import { executeAutomationRun } from '../src/run.ts'
import type { AutomationRecord } from '../src/types.ts'

const NOW = Date.parse('2026-09-12T10:00:00Z')

/** One due automation record for executor tests. */
function record(overrides: Record<string, unknown> = {}): AutomationRecord {
  return createAutomationRecord({
    title: 'run',
    prompt: 'Do the work.',
    trigger: { kind: 'once', at: NOW + 1000 },
    action: { kind: 'new-session', cwd: '/tmp' },
    ...overrides,
  }, AutomationId('automation-run'), NOW)
}

/** What the stub stack observed. */
interface Observed {
  creates: unknown[]
  disposes: number
  followups: string[]
  options: Array<Record<string, unknown> | undefined>
}

/** The turn/end event one completed window returns. */
function turnEnd(reason: unknown): () => unknown {
  return () => ({ type: 'turn/end', data: { reason } })
}

/**
 * Build one stub context whose agents registry answers exactly one create.
 * The stub session starts at seq 5 and grows to 7 when the prompt is submitted,
 * so the executor scans a two-event window holding `event`.
 * @param observed - observation sink.
 * @param event - the durable event every scanned offset returns.
 * @param failure - when `create`, create rejects with a long Error; when
 * `string`, it rejects with a plain string; when `dispose`, the owned handle's
 * dispose rejects instead.
 */
function stubContext(observed: Observed, event: () => unknown, failure?: 'create' | 'string' | 'dispose'): Context {
  const logger = { warn: vi.fn(), debug: vi.fn() }
  const session = {
    seq: 5,
    eventAt: (_seq: number) => event(),
  }
  const stub = {
    logger,
    agents: {
      withoutInitiator: <T>(operation: () => T): T => operation(),
      create: async (options: Record<string, unknown>) => {
        observed.creates.push(options)
        observed.options.push(options['agentOptions'] as Record<string, unknown> | undefined)
        if (failure === 'create') throw new Error('x'.repeat(400))
        if (failure === 'string') throw 'plain failure'
        return {
          agent: {
            session,
            whenIdle: async () => {},
            followup: (message: { content: Array<{ type: string; text?: string }> }) => {
              observed.followups.push(message.content.map(block => block.text).join(''))
              session.seq = 7
            },
          },
          dispose: async () => {
            observed.disposes += 1
            if (failure === 'dispose') throw new Error('dispose failed')
          },
        }
      },
    },
    agentDefaultModel: {
      currentSelection: () => ({ provider: 'mock', model: 'mock' }),
    },
    sessions: {
      flush: async () => true,
    },
  }
  return stub as unknown as Context
}

describe('executeAutomationRun', () => {
  it('derives an error outcome when the driven window records no turn outcome', async () => {
    const observed: Observed = { creates: [], disposes: 0, followups: [], options: [] }
    const ctx = stubContext(observed, () => undefined)
    const run = await executeAutomationRun(ctx, record(), new AbortController().signal)
    expect(run.outcome).toBe('error')
    expect(run.detail).toBe('no turn outcome was recorded')
    expect(observed.disposes).toBe(1)
  })

  it('skips non-turn events while scanning for the outcome', async () => {
    const observed: Observed = { creates: [], disposes: 0, followups: [], options: [] }
    const ctx = stubContext(observed, () => ({ type: 'user/message' }))
    const run = await executeAutomationRun(ctx, record(), new AbortController().signal)
    expect(run.outcome).toBe('error')
    expect(run.detail).toBe('no turn outcome was recorded')
  })

  it('records a non-completed turn end as a bounded error detail', async () => {
    const observed: Observed = { creates: [], disposes: 0, followups: [], options: [] }
    const ctx = stubContext(observed, turnEnd({ kind: 'blocked' }))
    const run = await executeAutomationRun(ctx, record(), new AbortController().signal)
    expect(run).toMatchObject({ outcome: 'error', detail: 'turn ended with blocked' })
  })

  it('routes through the current default selection when the record names no model', async () => {
    const observed: Observed = { creates: [], disposes: 0, followups: [], options: [] }
    const ctx = stubContext(observed, turnEnd({ kind: 'completed' }))
    const run = await executeAutomationRun(ctx, record(), new AbortController().signal)
    expect(run.outcome).toBe('completed')
    expect(observed.options[0]).toEqual({ provider: 'mock', model: 'mock' })
  })

  it('routes an explicit model with its output cap', async () => {
    const observed: Observed = { creates: [], disposes: 0, followups: [], options: [] }
    const ctx = stubContext(observed, turnEnd({ kind: 'completed' }))
    await executeAutomationRun(
      ctx,
      record({ model: { provider: 'p', model: 'm', maxTokens: 64 } }),
      new AbortController().signal,
    )
    expect(observed.options[0]).toEqual({ provider: 'p', model: 'm', maxTokens: 64 })
  })

  it('routes an explicit model without an output cap', async () => {
    const observed: Observed = { creates: [], disposes: 0, followups: [], options: [] }
    const ctx = stubContext(observed, turnEnd({ kind: 'completed' }))
    await executeAutomationRun(
      ctx,
      record({ model: { provider: 'p', model: 'm' } }),
      new AbortController().signal,
    )
    expect(observed.options[0]).toEqual({ provider: 'p', model: 'm' })
  })

  it('records a failed create as a bounded error detail and bounds over-long messages', async () => {
    const observed: Observed = { creates: [], disposes: 0, followups: [], options: [] }
    const ctx = stubContext(observed, turnEnd({ kind: 'completed' }), 'create')
    const run = await executeAutomationRun(ctx, record(), new AbortController().signal)
    expect(run.outcome).toBe('error')
    expect(run.detail!.length).toBe(200)
    expect(run.detail!.endsWith('…')).toBe(true)
  })

  it('stringifies non-error rejections', async () => {
    const observed: Observed = { creates: [], disposes: 0, followups: [], options: [] }
    const ctx = stubContext(observed, turnEnd({ kind: 'completed' }), 'string')
    const run = await executeAutomationRun(ctx, record(), new AbortController().signal)
    expect(run).toMatchObject({ outcome: 'error', detail: 'plain failure' })
  })

  it('rethrows when the runtime already aborted, without recording a run', async () => {
    const observed: Observed = { creates: [], disposes: 0, followups: [], options: [] }
    const ctx = stubContext(observed, turnEnd({ kind: 'completed' }))
    const controller = new AbortController()
    controller.abort(new Error('runtime stopped'))
    await expect(executeAutomationRun(ctx, record(), controller.signal)).rejects.toThrow('runtime stopped')
    expect(observed.creates).toHaveLength(0)
  })

  it('logs a cleanup warning when the owned handle fails to dispose', async () => {
    const observed: Observed = { creates: [], disposes: 0, followups: [], options: [] }
    const ctx = stubContext(observed, turnEnd({ kind: 'completed' }), 'dispose')
    const run = await executeAutomationRun(ctx, record(), new AbortController().signal)
    expect(run.outcome).toBe('completed')
    const logger = (ctx as unknown as { logger: { warn: ReturnType<typeof vi.fn> } }).logger
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('run cleanup failed'))
    expect(observed.disposes).toBe(1)
  })
})
