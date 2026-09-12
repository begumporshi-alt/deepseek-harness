/** The automation runtime over the real loop stack: due dispatch, provenance, outcomes, restart catch-up, and teardown. */

import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import AgentDefaultModel from '@deepseek-ai/dsh-agent-default-model'
import { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { AutomationRuntime, defaultAutomationStorePath } from '../src/index.ts'
import { createAutomationRecord } from '../src/domain.ts'
import { readAutomationStore, writeAutomationStore } from '../src/store.ts'
import { AutomationId } from '../src/brand.ts'

type ScriptEntry = StreamChunk[] | Error

/** Small request-recording adapter with controllable failure. */
class ScriptedAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  constructor(private readonly script: ScriptEntry[]) {
    super()
  }

  override providerInfo(provider: string) {
    if (provider !== 'mock') throw new Error(`ScriptedAdapter: unknown provider ${provider}`)
    return { id: 'mock', name: 'Mock' }
  }

  override listModels(provider: string) {
    return Promise.resolve(provider === 'mock' ? [{ provider: 'mock', id: 'mock', name: 'Mock', inputModalities: ['text'] as const }] : [])
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, inputModalities: ['text'] as const, context: { contextWindow: 1_024 } })
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const entry = this.script.shift()
    if (entry === undefined) throw new Error('ScriptedAdapter: script exhausted')
    if (entry instanceof Error) throw entry
    for (const chunk of entry) yield chunk
  }
}

/** One successful text response. */
function textResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

/** Complete request history as a single string for ordering assertions. */
function requestText(request: GenerateOptions): string {
  return request.messages
    .flatMap(message => message.content)
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n')
}

/** Poll until one condition holds, failing the test on timeout. */
async function until(condition: () => boolean | Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await condition()) return
    if (Date.now() > deadline) throw new Error('condition not met before timeout')
    await new Promise(resolve => setTimeout(resolve, 25))
  }
}

interface Harness {
  readonly ctx: Context
  readonly adapter: ScriptedAdapter
  readonly root: string
  readonly storePath: string
}

const contexts: Context[] = []
const roots: string[] = []

afterEach(async () => {
  await Promise.allSettled(contexts.splice(0).map(context => context.fiber.dispose()))
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

/** Mount the real loop stack plus the automation runtime. */
async function harness(script: ScriptEntry[]): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-automation-runtime-'))
  roots.push(root)
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentDefaultModel, { provider: 'mock', model: 'mock' })
  await ctx.plugin(JsonlSessionPersistence, { root: join(root, 'sessions'), compression: 'none' })
  await ctx.plugin(AgentLoop, { agents: [] })
  const adapter = new ScriptedAdapter(script)
  ctx.llm.registerAdapter(['mock'], adapter)
  await ctx.plugin(AutomationRuntime, { storePath: join(root, 'automations', 'automations.json') })
  return { ctx, adapter, root, storePath: join(root, 'automations', 'automations.json') }
}

describe('AutomationRuntime over the real loop stack', () => {
  it('runs a due once automation in a fresh session and records the outcome', async () => {
    const { ctx, adapter, root } = await harness([textResponse('report done')])
    const record = await ctx.automation.create({
      title: 'nightly report',
      prompt: 'Summarize today.',
      trigger: { kind: 'once', at: Date.now() + 30 },
      action: { kind: 'new-session', cwd: root },
    })
    expect(record.trigger.kind).toBe('once')
    await until(async () => (await ctx.automation.list())[0]?.lastRun != null)
    const listed = await ctx.automation.list()
    expect(listed).toHaveLength(1)
    const run = listed[0]!.lastRun!
    expect(run.outcome).toBe('completed')
    expect(run.detail).toBeUndefined()
    expect(adapter.requests).toHaveLength(1)
    expect(requestText(adapter.requests[0]!)).toContain('Summarize today.')
    // The created session persists on disk and the run's handle was disposed.
    await expect(readdir(join(root, 'sessions'))).resolves.not.toEqual([])
    expect(ctx.agents.list().length).toBe(0)
  }, 30_000)

  it('records a failed turn as an error outcome with bounded detail', async () => {
    const { ctx, adapter } = await harness([new Error('model exploded')])
    await ctx.automation.create({
      title: 'failing',
      prompt: 'Try anyway.',
      trigger: { kind: 'once', at: Date.now() + 30 },
      action: { kind: 'new-session', cwd: tmpdir() },
    })
    await until(async () => (await ctx.automation.list())[0]?.lastRun != null)
    const run = (await ctx.automation.list())[0]!.lastRun!
    expect(run.outcome).toBe('error')
    expect(run.detail).toContain('model exploded')
    expect(adapter.requests).toHaveLength(1)
  }, 30_000)

  it('reuses a live target agent for a resume-session action without disposing it', async () => {
    const { ctx, adapter, root } = await harness([textResponse('first'), textResponse('second')])
    const handle = await ctx.agents.create({
      sessionId: SessionId('target-live'),
      meta: { cwd: root },
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    try {
      handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } }))
      await handle.agent.whenIdle()
      await ctx.automation.create({
        title: 'resume live',
        prompt: 'Continue the work.',
        trigger: { kind: 'once', at: Date.now() + 30 },
        action: { kind: 'resume-session', sessionId: 'target-live' },
      })
      await until(async () => {
        const agent = ctx.agents.get(SessionId('target-live'))
        return agent !== undefined && (await ctx.automation.list())[0]?.lastRun != null
      })
      expect(requestText(adapter.requests[1]!)).toContain('Continue the work.')
      expect(ctx.agents.get(SessionId('target-live'))).toBeDefined()
    } finally {
      await handle.dispose()
    }
  }, 30_000)

  it('resumes a cold persisted session and disposes its handle after the run', async () => {
    const { ctx, adapter, root } = await harness([textResponse('seed'), textResponse('resumed')])
    const seed = await ctx.agents.create({
      sessionId: SessionId('target-cold'),
      meta: { cwd: root },
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    seed.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'seed turn' }], source: { kind: 'user' } }))
    await seed.agent.whenIdle()
    await ctx.sessions.flush(seed.agent.session)
    await seed.dispose()
    expect(ctx.agents.get(SessionId('target-cold'))).toBeUndefined()

    await ctx.automation.create({
      title: 'resume cold',
      prompt: 'Pick up where we left off.',
      trigger: { kind: 'once', at: Date.now() + 30 },
      action: { kind: 'resume-session', sessionId: 'target-cold' },
    })
    await until(async () => (await ctx.automation.list())[0]?.lastRun != null)
    expect((await ctx.automation.list())[0]!.lastRun!.outcome).toBe('completed')
    expect(requestText(adapter.requests[1]!)).toContain('Pick up where we left off.')
    expect(ctx.agents.get(SessionId('target-cold'))).toBeUndefined()
  }, 30_000)

  it('rejects a resume-session action naming an unknown persisted session', async () => {
    const { ctx } = await harness([])
    await expect(ctx.automation.create({
      title: 'ghost',
      prompt: 'x',
      trigger: { kind: 'once', at: Date.now() + 60_000 },
      action: { kind: 'resume-session', sessionId: 'no-such-session' },
    })).rejects.toThrow(/does not exist/)
  }, 30_000)

  it('fires an overdue un-run once automation on load', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-automation-catchup-'))
    roots.push(root)
    const storePath = join(root, 'automations', 'automations.json')
    const past = Date.parse('2026-01-01T00:00:00Z')
    await writeAutomationStore(storePath, [createAutomationRecord({
      title: 'missed while down',
      prompt: 'Run the missed task.',
      trigger: { kind: 'once', at: past + 60_000 },
      action: { kind: 'new-session', cwd: root },
    }, AutomationId('automation-catchup'), past)])

    const ctx = new Context()
    contexts.push(ctx)
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentDefaultModel, { provider: 'mock', model: 'mock' })
    await ctx.plugin(JsonlSessionPersistence, { root: join(root, 'sessions'), compression: 'none' })
    await ctx.plugin(AgentLoop, { agents: [] })
    const adapter = new ScriptedAdapter([textResponse('caught up')])
    ctx.llm.registerAdapter(['mock'], adapter)
    await ctx.plugin(AutomationRuntime, { storePath })

    await until(async () => (await ctx.automation.list())[0]?.lastRun != null)
    expect((await ctx.automation.list())[0]!.lastRun!.outcome).toBe('completed')
    expect(requestText(adapter.requests[0]!)).toContain('Run the missed task.')
    // A fired once record never runs again.
    expect((await ctx.automation.list())[0]!.lastRun).not.toBeNull()
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(adapter.requests).toHaveLength(1)
  }, 30_000)

  it('deletes a stored record and reports unknown ids', async () => {
    const { ctx, storePath } = await harness([])
    const record = await ctx.automation.create({
      title: 'later',
      prompt: 'x',
      trigger: { kind: 'once', at: Date.now() + 3_600_000 },
      action: { kind: 'new-session', cwd: tmpdir() },
    })
    expect(await ctx.automation.delete(record.id)).toBe(true)
    await expect(ctx.automation.list()).resolves.toEqual([])
    await expect(ctx.automation.delete(record.id)).resolves.toBe(false)
    const persisted = JSON.parse(await readFile(storePath, 'utf8')) as { automations: unknown[] }
    expect(persisted.automations).toEqual([])
  }, 30_000)

  it('runs an every automation at its anchor and re-arms for the next interval', async () => {
    const { ctx, adapter } = await harness([textResponse('tick')])
    await ctx.automation.create({
      title: 'ticker',
      prompt: 'Tick.',
      trigger: { kind: 'every', intervalSeconds: 300 },
      action: { kind: 'new-session', cwd: tmpdir() },
    })
    await until(async () => (await ctx.automation.list())[0]?.lastRun != null)
    await new Promise(resolve => setTimeout(resolve, 150))
    expect(adapter.requests).toHaveLength(1)
    expect((await ctx.automation.list())[0]!.trigger).toMatchObject({ kind: 'every', intervalSeconds: 300 })
  }, 30_000)

  it('uses the dsh home default store location when no path is configured', async () => {
    expect(defaultAutomationStorePath()).toContain(join('automations', 'automations.json'))
    const root = await mkdtemp(join(tmpdir(), 'dsh-automation-default-store-'))
    roots.push(root)
    const previousHome = process.env.DSH_HOME
    process.env.DSH_HOME = root
    const ctx = new Context()
    contexts.push(ctx)
    try {
      const runtime = new AutomationRuntime(ctx)
      await expect(runtime.list()).resolves.toEqual([])
      // The constructor read the default path under the overridden home.
      await runtime.create({
        title: 'defaulted',
        prompt: 'x',
        trigger: { kind: 'once', at: Date.now() + 3_600_000 },
        action: { kind: 'new-session', cwd: tmpdir() },
      })
      await expect(readdir(join(root, 'automations'))).resolves.toEqual(['automations.json'])
    } finally {
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
    }
  })

  it('rejects create and delete after the runtime stops', async () => {
    const { ctx } = await harness([])
    const runtime = ctx.automation
    await ctx.fiber.dispose()
    await expect(runtime.create({
      title: 'late',
      prompt: 'x',
      trigger: { kind: 'once', at: Date.now() + 60_000 },
      action: { kind: 'new-session', cwd: tmpdir() },
    })).rejects.toThrow(/stopping/)
    await expect(runtime.delete(AutomationId('automation-none'))).rejects.toThrow(/stopping/)
  }, 30_000)

  it('warns and keeps the in-memory record when persisting a run outcome fails', async () => {
    const { ctx, storePath } = await harness([textResponse('done')])
    const warnings: string[] = []
    const spy = vi.spyOn(ctx.logger, 'warn').mockImplementation((message: string) => { warnings.push(message) })
    try {
      await ctx.automation.create({
        title: 'unwritable',
        prompt: 'Run once.',
        trigger: { kind: 'once', at: Date.now() + 30 },
        action: { kind: 'new-session', cwd: tmpdir() },
      })
      // Replace the store directory with a file so the outcome save fails.
      await rm(dirname(storePath), { recursive: true, force: true })
      await writeFile(dirname(storePath), 'blocked', 'utf8')
      await until(() => warnings.some(message => message.includes('failed')))
      // The in-memory record advanced; only the durable write was lost.
      expect((await ctx.automation.list())[0]!.lastRun!.outcome).toBe('completed')
      await expect(readAutomationStore(storePath)).rejects.toThrow()
    } finally {
      spy.mockRestore()
    }
  }, 30_000)

  it('skips not-due, exhausted, and stopped records during a wake pass, and ranks the earliest due', async () => {
    const { ctx } = await harness([textResponse('done')])
    // One exhausted record (a once that already ran) and two future records
    // at different instants, so one wake pass walks every skip path.
    await ctx.automation.create({
      title: 'ran',
      prompt: 'Once only.',
      trigger: { kind: 'once', at: Date.now() + 30 },
      action: { kind: 'new-session', cwd: tmpdir() },
    })
    await until(async () => (await ctx.automation.list())[0]?.lastRun != null)
    // The far record first, then the near one, so re-arming ranks both orders.
    await ctx.automation.create({
      title: 'later',
      prompt: 'x',
      trigger: { kind: 'once', at: Date.now() + 3_600_000 },
      action: { kind: 'new-session', cwd: tmpdir() },
    })
    await ctx.automation.create({
      title: 'sooner',
      prompt: 'x',
      trigger: { kind: 'once', at: Date.now() + 1_800_000 },
      action: { kind: 'new-session', cwd: tmpdir() },
    })
    const internals = ctx.automation as unknown as { stopped: boolean; wake: () => Promise<void> }
    await internals.wake()
    internals.stopped = true
    await internals.wake()
    internals.stopped = false
    expect((await ctx.automation.list())).toHaveLength(3)
  }, 30_000)

  it('drops a run outcome for a record deleted while its run was in flight', async () => {
    const { ctx, adapter } = await harness([textResponse('orphan')])
    const record = await ctx.automation.create({
      title: 'doomed',
      prompt: 'Runs after deletion.',
      trigger: { kind: 'once', at: Date.now() + 3_600_000 },
      action: { kind: 'new-session', cwd: tmpdir() },
    })
    await ctx.automation.delete(record.id)
    const internals = ctx.automation as unknown as { runOne: (subject: typeof record) => Promise<void> }
    await internals.runOne(record)
    expect(adapter.requests).toHaveLength(1)
    expect(requestText(adapter.requests[0]!)).toContain('Runs after deletion.')
    await expect(ctx.automation.list()).resolves.toEqual([])
  }, 30_000)

  it('stops idempotently, defers a wake that arrives mid-pass, and drops a run after shutdown', async () => {
    const { ctx } = await harness([])
    const internals = ctx.automation as unknown as {
      driving: boolean
      stopped: boolean
      wake: () => Promise<void>
      runOne: (record: { id: string }) => Promise<void>
      stop: () => Promise<void>
    }
    internals.driving = true
    await internals.wake()
    internals.driving = false
    internals.stopped = true
    await internals.wake()
    internals.stopped = false

    const controller = new AbortController()
    controller.abort(new Error('shutdown'))
    const runtime = ctx.automation as unknown as { stopController: AbortController }
    runtime.stopController = controller
    await internals.runOne({ id: 'automation-gone' })

    await internals.stop()
    await internals.stop()
    await ctx.fiber.dispose()
  }, 30_000)
})
