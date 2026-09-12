import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Memory, { MemoryError } from '@deepseek-ai/dsh-memory'
import { apply, findProjectRoot } from '@deepseek-ai/dsh-memory-local'

const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  for (const context of contexts.splice(0)) await context.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function bootedContext(config: { dir?: string; maxEntryChars?: number; maxListEntries?: number } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-memory-local-plugin-'))
  roots.push(root)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Memory)
  apply(ctx, { dir: config.dir ?? join(root, 'memory'), ...config })
  return { root, ctx }
}

describe('memory-local plugin', () => {
  it('registers a working provider over the memory service', async () => {
    const { ctx } = await bootedContext()
    const entry = await ctx.memory.record({ kind: 'feedback', content: 'Prefer focused tests.' })
    await expect(ctx.memory.list()).resolves.toEqual([entry])
  })

  it('fails loud when applied twice on one service', async () => {
    const { ctx } = await bootedContext()
    expect(() => { apply(ctx, { dir: join(roots[0]!, 'memory-2') }) }).toThrow(MemoryError)
  })

  it('fails load on non-positive or non-integer bounds', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-memory-local-bounds-'))
    roots.push(root)
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(Memory)
    expect(() => { apply(ctx, { dir: join(root, 'memory'), maxEntryChars: 0 }) }).toThrow(/maxEntryChars/)
    expect(() => { apply(ctx, { dir: join(root, 'memory'), maxEntryChars: 1.5 }) }).toThrow(/maxEntryChars/)
    expect(() => { apply(ctx, { dir: join(root, 'memory'), maxListEntries: -1 }) }).toThrow(/maxListEntries/)
  })

  it('walks up to the nearest .git ancestor and falls back to the cwd', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-memory-local-root-'))
    roots.push(root)
    await mkdir(join(root, '.git'), { recursive: true })
    const child = join(root, 'deep', 'deeper')
    await mkdir(child, { recursive: true })
    await expect(findProjectRoot(child)).resolves.toBe(root)

    const noGit = await mkdtemp(join(tmpdir(), 'dsh-memory-local-nogit-'))
    roots.push(noGit)
    await expect(findProjectRoot(join(noGit, 'sub'))).resolves.toBe(join(noGit, 'sub'))
  })
})
