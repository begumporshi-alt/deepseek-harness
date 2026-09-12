import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LocalMemoryStore } from '@deepseek-ai/dsh-memory-local'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { MemoryId } from '@deepseek-ai/dsh-memory'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function store(overrides: Partial<{ maxEntryChars: number; maxListEntries: number; resolveDirCalls: string[] }> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-memory-local-'))
  roots.push(root)
  const calls = overrides.resolveDirCalls ?? []
  return {
    root,
    store: new LocalMemoryStore({
      resolveDir: () => {
        calls.push('resolve')
        return Promise.resolve(join(root, 'memory'))
      },
      maxEntryChars: overrides.maxEntryChars ?? 4_000,
      maxListEntries: overrides.maxListEntries ?? 200,
      now: () => 1_700_000_000_000,
    }),
  }
}

describe('LocalMemoryStore', () => {
  it('records an entry as frontmatter markdown and reads it back', async () => {
    const { root, store: local } = await store()
    const entry = await local.record({ kind: 'project', content: 'Uses pnpm workspaces.' })
    expect(entry.id).toMatch(/^mem_/)
    expect(entry.kind).toBe('project')
    expect(entry.createdAt).toBe(1_700_000_000_000)
    expect(entry.updatedAt).toBe(entry.createdAt)

    const files = await readdir(join(root, 'memory', 'entries'))
    expect(files).toEqual([`${entry.id}.md`])
    const raw = await readFile(join(root, 'memory', 'entries', `${entry.id}.md`), 'utf8')
    expect(raw).toContain('kind: project')
    expect(raw.trimEnd().endsWith('Uses pnpm workspaces.')).toBe(true)

    await expect(local.list()).resolves.toEqual([entry])
  })

  it('reads an empty list before the store directory exists', async () => {
    const { store: local } = await store()
    await expect(local.list()).resolves.toEqual([])
    await expect(local.search('x')).resolves.toEqual([])
  })

  it('resolves the store directory once and caches it', async () => {
    const calls: string[] = []
    const { store: local } = await store({ resolveDirCalls: calls })
    await local.record({ kind: 'user', content: 'a' })
    await local.list()
    await local.search('a')
    expect(calls).toEqual(['resolve'])
  })

  it('lists newest change first and caps results', async () => {
    let tick = 1_700_000_000_000
    const root = await mkdtemp(join(tmpdir(), 'dsh-memory-local-'))
    roots.push(root)
    const local = new LocalMemoryStore({
      resolveDir: () => Promise.resolve(join(root, 'memory')),
      maxEntryChars: 4_000,
      maxListEntries: 2,
      now: () => (tick += 1_000),
    })
    const first = await local.record({ kind: 'user', content: 'oldest' })
    const second = await local.record({ kind: 'user', content: 'middle' })
    await local.record({ kind: 'user', content: 'newest' })
    const listed = await local.list()
    expect(listed.map(entry => entry.content)).toEqual(['newest', 'middle'])
    expect(listed.map(entry => entry.id)).not.toContain(first.id)
    void second
  })

  it('searches case-insensitively over content and caps results', async () => {
    const { store: local } = await store()
    await local.record({ kind: 'user', content: 'Prefers Lapsang tea' })
    await local.record({ kind: 'project', content: 'Ships weekly' })
    await expect(local.search('LAPSANG')).resolves.toHaveLength(1)
    await expect(local.search('zzz')).resolves.toEqual([])
    await expect(local.search('')).resolves.toHaveLength(2)
  })

  it('rejects empty and oversized content without touching the store', async () => {
    const { root, store: local } = await store({ maxEntryChars: 10 })
    await expect(local.record({ kind: 'user', content: '   ' })).rejects.toMatchObject({ code: 'invalid-content' })
    await expect(local.record({ kind: 'user', content: 'x'.repeat(11) })).rejects.toMatchObject({ code: 'content-too-large' })
    await expect(readdir(join(root, 'memory')).catch(() => 'missing')).resolves.toBe('missing')
  })

  it('forgets existing entries and reports unknown ids', async () => {
    const { store: local } = await store()
    const entry = await local.record({ kind: 'reference', content: 'docs at /roadmap' })
    await expect(local.forget(entry.id)).resolves.toBe(true)
    await expect(local.list()).resolves.toEqual([])
    await expect(local.forget(brandString<MemoryId>('mem_missing'))).resolves.toBe(false)
  })

  it('ignores non-markdown files', async () => {
    const { root, store: local } = await store()
    await mkdir(join(root, 'memory', 'entries'), { recursive: true })
    await writeFile(join(root, 'memory', 'entries', 'notes.txt'), 'not an entry')
    await expect(local.list()).resolves.toEqual([])
  })

  it('retries id allocation on the astronomically unlikely collision', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-memory-local-'))
    roots.push(root)
    const local = new LocalMemoryStore({
      resolveDir: () => Promise.resolve(join(root, 'memory')),
      maxEntryChars: 4_000,
      maxListEntries: 200,
      now: () => 1_700_000_000_000,
      randomHex: (() => {
        const values = ['aaaa', 'bbbb']
        return () => values.shift() ?? 'cccc'
      })(),
    })
    await mkdir(join(root, 'memory', 'entries'), { recursive: true })
    await writeFile(join(root, 'memory', 'entries', 'mem_loyw3v28_aaaa.md'), 'occupied')
    const entry = await local.record({ kind: 'user', content: 'collision test' })
    expect(entry.id).toBe('mem_loyw3v28_bbbb')
  })

  it('fails loud naming the file on malformed entries', async () => {
    const { root, store: local } = await store()
    const entries = join(root, 'memory', 'entries')
    await mkdir(entries, { recursive: true })
    await writeFile(join(entries, 'a.md'), 'no frontmatter here\n')
    await expect(local.list()).rejects.toThrow(/a\.md is missing its frontmatter header/)

    await writeFile(join(entries, 'a.md'), '---\nid: mem_a\nkind: user\n')
    await expect(local.list()).rejects.toThrow(/a\.md has an unterminated frontmatter header/)

    await writeFile(join(entries, 'a.md'), '---\nkind nonsense line\n---\nbody\n')
    await expect(local.list()).rejects.toThrow(/a\.md has a malformed frontmatter line/)

    await writeFile(join(entries, 'a.md'), '---\nid: mem_a\nkind: nonsense\ncreatedAt: 1\nupdatedAt: 2\n---\nbody\n')
    await expect(local.list()).rejects.toThrow(/a\.md is missing required frontmatter fields/)
  })
})
