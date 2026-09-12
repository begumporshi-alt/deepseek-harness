import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Memory from '@deepseek-ai/dsh-memory'
import * as MemoryLocal from '@deepseek-ai/dsh-memory-local'
import * as ToolMemory from '@deepseek-ai/dsh-tool-memory'
import { unsupportedInbox } from '@deepseek-ai/dsh-agent-loop-testkit'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

function agent(ctx: Context): Agent {
  const scope = ctx.plugin(() => {})
  const id = SessionId('memory-composition-agent')
  const session = Session.create(id)
  const value: Agent = {
    id, options: {}, session, inbox: unsupportedInbox(),
    status: 'idle', ctx: scope.ctx,
    followup: () => {}, steer: () => {}, inject: () => {}, send: () => {}, cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  ctx.agents.register(value)
  return value
}

function resultText(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

async function execute(
  ctx: Context,
  owner: Agent,
  name: string,
  args: Record<string, unknown>,
): Promise<{ isError: boolean; text: string }> {
  const result = await ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId(`memory-${name}-${Math.random().toString(36).slice(2)}`),
    name,
    arguments: args,
    agent: owner,
  })
  return { isError: result.isError, text: resultText(result) }
}

async function boot(options: { withProvider: boolean; configLines?: string[] }): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-memory-loader-'))
  const configPath = join(root, 'cordis.yml')
  const providerRows: string[] = []
  if (options.withProvider) {
    providerRows.push(
      "- name: '@deepseek-ai/dsh-memory-local'",
      '  config:',
      `    dir: ${JSON.stringify(join(root, 'memory'))}`,
      ...(options.configLines ?? []),
    )
  }
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-agent'",
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-memory'",
    ...providerRows,
    "- name: '@deepseek-ai/dsh-tool-memory'",
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-memory', Memory],
    ['@deepseek-ai/dsh-memory-local', MemoryLocal],
    ['@deepseek-ai/dsh-tool-memory', ToolMemory],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  return ctx
}

const MEMORY_TOOL_NAMES = ['memory_save', 'memory_search', 'memory_list', 'memory_forget']

describe('tool-memory real Loader composition through cordis.yml', () => {
  it('registers the memory tools and round-trips a durable entry', async () => {
    const ctx = await boot({ withProvider: true })
    for (const name of MEMORY_TOOL_NAMES) {
      expect(ctx.tools.schemas().some(schema => schema.name === name)).toBe(true)
    }

    const owner = agent(ctx)
    const saved = await execute(ctx, owner, 'memory_save', { kind: 'project', content: 'Uses pnpm workspaces.' })
    expect(saved.isError).toBe(false)
    const savedValue = JSON.parse(saved.text) as { entry: { id: string; kind: string; content: string } }
    expect(savedValue.entry.kind).toBe('project')
    expect(savedValue.entry.content).toBe('Uses pnpm workspaces.')

    // The entry is durable on disk under the configured store directory.
    const entriesDir = join(root!, 'memory', 'entries')
    const files = await readdir(entriesDir)
    expect(files).toEqual([`${savedValue.entry.id}.md`])
    const raw = await readFile(join(entriesDir, files[0]!), 'utf8')
    expect(raw).toContain('kind: project')

    const listed = await execute(ctx, owner, 'memory_list', {})
    expect((JSON.parse(listed.text) as { entries: unknown[] }).entries).toHaveLength(1)

    const searched = await execute(ctx, owner, 'memory_search', { query: 'PNPM' })
    expect((JSON.parse(searched.text) as { entries: unknown[] }).entries).toHaveLength(1)

    const forgotten = await execute(ctx, owner, 'memory_forget', { id: savedValue.entry.id })
    expect(JSON.parse(forgotten.text) as { id: string; deleted: boolean }).toEqual({ id: savedValue.entry.id, deleted: true })
    const forgottenAgain = await execute(ctx, owner, 'memory_forget', { id: savedValue.entry.id })
    expect(JSON.parse(forgottenAgain.text) as { id: string; deleted: boolean }).toEqual({ id: savedValue.entry.id, deleted: false })
  }, 30_000)

  it('maps store bounds onto schema error values', async () => {
    const ctx = await boot({ withProvider: true, configLines: ['    maxEntryChars: 20'] })
    const owner = agent(ctx)
    const oversized = await execute(ctx, owner, 'memory_save', { kind: 'user', content: 'x'.repeat(21) })
    expect(oversized.isError).toBe(false)
    expect((JSON.parse(oversized.text) as { code: string }).code).toBe('content_too_large')

    const empty = await execute(ctx, owner, 'memory_save', { kind: 'user', content: '   ' })
    expect((JSON.parse(empty.text) as { code: string }).code).toBe('invalid_content')
  }, 30_000)

  it('surfaces a missing provider as provider_unavailable and disposes tools with the fiber', async () => {
    const ctx = await boot({ withProvider: false })
    const owner = agent(ctx)
    const saved = await execute(ctx, owner, 'memory_save', { kind: 'user', content: 'fact' })
    expect((JSON.parse(saved.text) as { code: string }).code).toBe('provider_unavailable')

    await ctx.fiber.dispose()
    context = undefined
    // Disposing the root fiber tears down the whole composition, tool
    // registry included; provider-level disposal is proven at unit level.
    expect(ctx.tools).toBeUndefined()
  }, 30_000)
})
