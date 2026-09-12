import { describe, expect, it, vi, afterEach } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Memory, { MemoryError } from '@deepseek-ai/dsh-memory'
import type { MemoryId } from '@deepseek-ai/dsh-memory'
import { brandString } from '@deepseek-ai/dsh-brand'
import { apply as applyMemoryLocal } from '@deepseek-ai/dsh-memory-local'
import { apply as applyToolMemory, memoryErrorValue, registerMemoryTools } from '@deepseek-ai/dsh-tool-memory'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const roots: string[] = []
const cwdSpies: { mockRestore(): void }[] = []

afterEach(async () => {
  for (const spy of cwdSpies.splice(0)) spy.mockRestore()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('memoryErrorValue mapping', () => {
  it('keeps record-input codes and maps wiring failures to provider_unavailable', () => {
    expect(memoryErrorValue(new MemoryError('invalid-content', 'empty'))).toEqual({ code: 'invalid_content', message: 'empty' })
    expect(memoryErrorValue(new MemoryError('content-too-large', 'big'))).toEqual({ code: 'content_too_large', message: 'big' })
    expect(memoryErrorValue(new MemoryError('provider-missing', 'none')).code).toBe('provider_unavailable')
    expect(memoryErrorValue(new MemoryError('duplicate-provider', 'twice')).code).toBe('internal_error')
  })

  it('maps non-Memory errors and non-error rejections onto internal_error', () => {
    expect(memoryErrorValue(new Error('boom')).code).toBe('internal_error')
    expect(memoryErrorValue('boom').code).toBe('internal_error')
    expect(memoryErrorValue(42).message).toBe('42')
  })
})

describe('tool-memory plugin config', () => {
  it('fails load on a non-positive index line cap', () => {
    const ctx = new Context()
    expect(() => { applyToolMemory(ctx, { indexLineMaxChars: 0 }) }).toThrow(/indexLineMaxChars/)
    expect(() => { applyToolMemory(ctx, { indexLineMaxChars: 1.5 }) }).toThrow(/indexLineMaxChars/)
  })
})

describe('memory-local default store directory', () => {
  it('falls back to the nearest .git ancestor of the working directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-memory-default-dir-'))
    roots.push(root)
    cwdSpies.push(vi.spyOn(process, 'cwd').mockReturnValue(root))
    const ctx = new Context()
    await ctx.plugin(Memory)
    applyMemoryLocal(ctx, {})
    const entry = await ctx.memory.record({ kind: 'user', content: 'default dir entry' })
    const entriesDir = join(root, '.dsh', 'memory', 'entries')
    await expect(readdir(entriesDir)).resolves.toEqual([`${entry.id}.md`])
  })
})

describe('Memory service stale disposers', () => {
  it('ignores a disposer whose provider was already replaced by a fresh registration', async () => {
    const memory = new Memory(new Context())
    const first = memory.registerProvider({
      id: 'first',
      async record() { throw new Error('unused') },
      list: async () => [],
      search: async () => [],
      forget: async () => false,
    })
    first()
    memory.registerProvider({
      id: 'second',
      async record() { throw new Error('unused') },
      list: async () => [],
      search: async () => [],
      forget: async () => false,
    })
    first()
    await expect(memory.list()).resolves.toEqual([])
    expect(() => memory.forget(brandString<MemoryId>('mem_x'))).not.toThrow()
  })
})

describe('memory tool error values through the registry contract', () => {
  class ExplodingMemory {
    id = 'exploding'
    async record() { throw new Error('save failed') }
    async list() { throw new Error('list failed') }
    async search() { throw new Error('search failed') }
    async forget() { throw new Error('forget failed') }
  }

  function captureTools(memory: Memory): Map<string, { execute: (args: Record<string, unknown>) => Promise<unknown> }> {
    const registered = new Map<string, { execute: (args: Record<string, unknown>) => Promise<unknown> }>()
    const ctx = {
      tools: {
        register: (definition: { name: string; execute: (args: Record<string, unknown>) => Promise<unknown> }) => {
          registered.set(definition.name, definition)
        },
      },
    } as unknown as Context
    registerMemoryTools(ctx, memory)
    return registered
  }

  it('maps provider rejections on every tool onto schema error values', async () => {
    const tools = captureTools(new ExplodingMemory() as unknown as Memory)
    const save = await tools.get('memory_save')!.execute({ kind: 'user', content: 'x' })
    expect(save).toMatchObject({ code: 'internal_error', message: 'save failed' })
    expect(await tools.get('memory_search')!.execute({ query: 'x' })).toMatchObject({ code: 'internal_error' })
    expect(await tools.get('memory_list')!.execute({})).toMatchObject({ code: 'internal_error' })
    expect(await tools.get('memory_forget')!.execute({ id: 'mem_x' })).toMatchObject({ code: 'internal_error' })
  })
})
