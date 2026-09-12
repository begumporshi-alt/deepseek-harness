import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Memory, { MemoryError } from '@deepseek-ai/dsh-memory'
import type { MemoryEntry, MemoryId, MemoryProvider } from '@deepseek-ai/dsh-memory'
import { brandString } from '@deepseek-ai/dsh-brand'

/** Provider stub recording the calls it receives. */
function fakeProvider(entries: MemoryEntry[] = []): MemoryProvider & { calls: string[] } {
  return {
    id: 'fake',
    calls: [],
    async record(input) {
      this.calls.push(`record:${input.kind}`)
      const now = Date.now()
      return { id: brandString<MemoryId>('mem_test'), kind: input.kind, content: input.content, createdAt: now, updatedAt: now }
    },
    async list() {
      this.calls.push('list')
      return entries
    },
    async search(query) {
      this.calls.push(`search:${query}`)
      return entries.filter(entry => entry.content.includes(query))
    },
    async forget(id) {
      this.calls.push(`forget:${id}`)
      return true
    },
  }
}

function entryWith(content: string): MemoryEntry {
  const now = Date.now()
  return { id: brandString<MemoryId>('mem_x'), kind: 'project', content, createdAt: now, updatedAt: now }
}

describe('Memory service', () => {
  it('fails loud on every operation when no provider is registered', () => {
    const memory = new Memory(new Context())
    expect(() => memory.record({ kind: 'user', content: 'x' })).toThrow(MemoryError)
    expect(() => memory.list()).toThrow(MemoryError)
    expect(() => memory.search('x')).toThrow(MemoryError)
    expect(() => memory.forget(brandString<MemoryId>('mem_x'))).toThrow(MemoryError)
    expect(() => {
      try {
        void memory.list()
      } catch (error) {
        expect((error as MemoryError).code).toBe('provider-missing')
        throw error
      }
    }).toThrow(MemoryError)
  })

  it('delegates every operation to the registered provider', async () => {
    const memory = new Memory(new Context())
    const provider = fakeProvider([entryWith('alpha content')])
    memory.registerProvider(provider)
    await expect(memory.record({ kind: 'user', content: 'fact' })).resolves.toMatchObject({ kind: 'user', content: 'fact' })
    await expect(memory.list()).resolves.toHaveLength(1)
    await expect(memory.search('alp')).resolves.toHaveLength(1)
    await expect(memory.forget(brandString<MemoryId>('mem_x'))).resolves.toBe(true)
    expect(provider.calls).toEqual(['record:user', 'list', 'search:alp', 'forget:mem_x'])
  })

  it('fails loud on a duplicate provider and keeps the first working', async () => {
    const memory = new Memory(new Context())
    const first = fakeProvider()
    memory.registerProvider(first)
    expect(() => memory.registerProvider(fakeProvider())).toThrow(MemoryError)
    try {
      memory.registerProvider(fakeProvider())
    } catch (error) {
      expect((error as MemoryError).code).toBe('duplicate-provider')
      expect((error as MemoryError).message).toContain('"fake"')
    }
    await expect(memory.list()).resolves.toHaveLength(0)
    expect(first.calls).toEqual(['list'])
  })

  it('removes the provider on disposal so HMR swaps re-register cleanly', () => {
    const memory = new Memory(new Context())
    const dispose = memory.registerProvider(fakeProvider())
    dispose()
    expect(() => memory.list()).toThrow(MemoryError)
    const second = fakeProvider()
    memory.registerProvider(second)
    expect(second.calls).toEqual([])
  })
})
