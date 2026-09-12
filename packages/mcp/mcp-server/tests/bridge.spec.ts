import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { GenerateOptions, LlmAdapter, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import Memory from '@deepseek-ai/dsh-memory'
import * as MemoryLocal from '@deepseek-ai/dsh-memory-local'
import * as ToolMemory from '@deepseek-ai/dsh-tool-memory'
import { apply as mountMcpServer, toMcpContent, toMcpTool } from '@deepseek-ai/dsh-mcp-server'

/** Scripted no-op adapter so the loop can boot without a real provider. */
class SilentAdapter extends LlmAdapter {
  override providerInfo(provider: string) {
    if (provider !== 'mock') throw new Error(`SilentAdapter: unknown provider ${provider}`)
    return { id: 'mock', name: 'Mock' }
  }

  override listModels(provider: string) {
    return Promise.resolve(provider === 'mock' ? [{ provider: 'mock', id: 'mock', name: 'Mock', inputModalities: ['text'] as const }] : [])
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, inputModalities: ['text'] as const, context: { contextWindow: 1_024 } })
  }

  override async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    throw new Error('SilentAdapter: no model turn was scripted')
  }
}

const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  for (const context of contexts.splice(0)) await context.fiber.dispose().catch(() => {})
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

interface Bridge {
  ctx: Context
  client: Client
  storeRoot: string
  dispose: () => Promise<void>
}

/** Boot the real loop stack plus the memory tools, and connect the bridge over an in-memory MCP transport. */
async function makeBridge(options: { modelSelection?: boolean } = {}): Promise<Bridge> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-mcp-server-'))
  roots.push(root)
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(JsonlSessionPersistence, { root: join(root, 'sessions'), compression: 'none' })
  await ctx.plugin(TokenMeter)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], new SilentAdapter())
  await ctx.plugin(Memory)
  await ctx.plugin({ name: 'memory-local', inject: MemoryLocal.inject, apply: (inner: Context) => { MemoryLocal.apply(inner, { dir: join(root, 'memory') }) } })
  await ctx.plugin(ToolMemory)

  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
  await ctx.plugin({
    name: 'mcp-server-test',
    inject: ['agents', 'sessions', 'tools'],
    apply: (inner: Context) => {
      mountMcpServer(inner, {
        ...(options.modelSelection === false ? {} : { provider: 'mock', model: 'mock' }),
        transport: serverTransport,
      })
    },
  })
  const client = new Client({ name: 'dsh-mcp-server-test-client', version: '0.0.0' })
  await client.connect(clientTransport)
  return { ctx, client, storeRoot: join(root, 'memory'), dispose: async () => { await client.close(); await ctx.fiber.dispose() } }
}

describe('MCP server bridge over the real loop stack', () => {
  it('lists the memory tools with standard-JSON-Schema inputs', async () => {
    const bridge = await makeBridge()
    const { tools } = await bridge.client.listTools()
    const names = tools.map(tool => tool.name).sort()
    expect(names).toEqual(['memory_forget', 'memory_list', 'memory_save', 'memory_search'])
    const save = tools.find(tool => tool.name === 'memory_save')
    expect(save?.inputSchema).toMatchObject({ type: 'object', required: ['kind', 'content'] })
  }, 30_000)

  it('round-trips a durable entry through tools/call', async () => {
    const bridge = await makeBridge()
    const saved = await bridge.client.callTool({ name: 'memory_save', arguments: { kind: 'project', content: 'Uses pnpm workspaces.' } })
    expect(saved.isError).not.toBe(true)
    const files = await readdir(join(bridge.storeRoot, 'entries'))
    expect(files).toHaveLength(1)
    const raw = await readFile(join(bridge.storeRoot, 'entries', files[0]!), 'utf8')
    expect(raw).toContain('kind: project')

    const listed = await bridge.client.callTool({ name: 'memory_list', arguments: {} })
    const text = (listed.content as Array<{ type: string; text?: string }>).map(block => block.text).join('')
    expect(text).toContain('Uses pnpm workspaces.')
  }, 30_000)

  it('defaults omitted call arguments to an empty object', async () => {
    const bridge = await makeBridge()
    const listed = await bridge.client.callTool({ name: 'memory_list' })
    expect(listed.isError).not.toBe(true)
  }, 30_000)

  it('rejects an unknown tool with a protocol error', async () => {
    const bridge = await makeBridge()
    await expect(bridge.client.callTool({ name: 'no_such_tool', arguments: {} })).rejects.toThrow(/unknown tool/)
  }, 30_000)

  it('closes the transport when the harness disposes the bridge', async () => {
    const bridge = await makeBridge()
    await bridge.dispose()
    await expect(bridge.client.listTools()).rejects.toThrow()
  }, 30_000)

  it('tears the bridge down when the MCP client disconnects', async () => {
    const bridge = await makeBridge({ modelSelection: false })
    await bridge.client.callTool({ name: 'memory_list', arguments: {} })
    await bridge.client.close()
    await vi.waitFor(() => {
      expect(bridge.ctx.sessions.list().length).toBe(0)
    })
    await bridge.ctx.fiber.dispose()
  }, 30_000)

  it('tears down without creating an agent when the transport fails to connect', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-mcp-server-dead-'))
    roots.push(root)
    const ctx = new Context()
    contexts.push(ctx)
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(JsonlSessionPersistence, { root: join(root, 'sessions'), compression: 'none' })
    await ctx.plugin(TokenMeter)
    await ctx.plugin(AgentLoop, { agents: [] })
    ctx.llm.registerAdapter(['mock'], new SilentAdapter())
    const deadTransport = {
      start: async () => { throw new Error('no transport available') },
      send: async () => {},
      close: async () => {},
    } as unknown as Transport
    ctx.plugin({
      name: 'mcp-server-dead-test',
      inject: ['agents', 'sessions', 'tools'],
      apply: (inner: Context) => { mountMcpServer(inner, { transport: deadTransport }) },
    })
    await vi.waitFor(() => {
      expect(ctx.sessions.list().length).toBe(0)
    })
  }, 30_000)
})

describe('MCP projection helpers', () => {
  it('projects a harness tool schema onto the MCP description shape', () => {
    const description = toMcpTool({ name: 'memory_save', description: 'Save one fact.', parameters: { type: 'object', properties: { content: { type: 'string', required: true } } } })
    expect(description).toMatchObject({ name: 'memory_save', description: 'Save one fact.', inputSchema: { required: ['content'] } })
  })

  it('defaults a missing parameter schema to an empty object schema', () => {
    const description = toMcpTool({ name: 'memory_list' })
    expect(description.inputSchema).toEqual({ type: 'object', properties: {} })
    expect(description.description).toBeUndefined()
  })

  it('maps text content and degrades other blocks to diagnostics', () => {
    const mapped = toMcpContent([
      { type: 'text', text: 'saved' } as never,
      { type: 'image', attachment: {} } as never,
    ])
    expect(mapped).toEqual([
      { type: 'text', text: 'saved' },
      { type: 'text', text: '[image content omitted by the MCP bridge]' },
    ])
  })
})
