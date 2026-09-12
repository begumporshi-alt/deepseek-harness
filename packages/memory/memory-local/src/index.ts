/**
 * Local filesystem provider for the memory capability seam (`ctx.memory`).
 * Stores one markdown file per entry under a configurable directory,
 * resolved from the project root by default.
 * @module @deepseek-ai/dsh-memory-local
 */

import { access } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { LocalMemoryStore } from './store.ts'

export { LocalMemoryStore } from './store.ts'
export type { LocalMemoryStoreOptions } from './store.ts'

/** Cordis function-plugin name. */
export const name = 'memory-local'

/** Services required before the provider can register. */
export const inject = ['memory']

/** Default cap on one entry's content length in characters. */
export const DEFAULT_MAX_ENTRY_CHARS = 4_000

/** Default cap on the number of entries `list` and `search` return. */
export const DEFAULT_MAX_LIST_ENTRIES = 200

/** Provider configuration. Invalid values fail plugin load. */
export interface Config {
  /**
   * Directory holding the memory store. Defaults to
   * `<projectRoot>/.dsh/memory`, where the project root is the nearest
   * ancestor of the working directory containing `.git`.
   */
  dir?: string
  /** Maximum characters of content one entry may hold. Defaults to 4000. */
  maxEntryChars?: number
  /** Maximum number of entries `list` and `search` return. Defaults to 200. */
  maxListEntries?: number
}

/** Schemastery validation for {@link Config}. */
export const Config: z<Config> = z.object({
  dir: z.string(),
  maxEntryChars: z.number(),
  maxListEntries: z.number(),
})

/**
 * Find the nearest ancestor of `cwd` containing `.git`, mirroring the
 * project-root rule used by skill discovery; falls back to `cwd` itself.
 * @param cwd - Directory to walk upward from.
 * @returns the project root directory.
 */
export async function findProjectRoot(cwd: string): Promise<string> {
  let current = resolve(cwd)
  for (;;) {
    try {
      await access(join(current, '.git'))
      return current
    } catch {
      // Not the project root; keep walking.
    }
    const parent = dirname(current)
    if (parent === current) return resolve(cwd)
    current = parent
  }
}

/** Resolve the store directory once: the configured value, else the project default. */
function resolveStoreDir(configured: string | undefined): () => Promise<string> {
  if (configured !== undefined) {
    const configuredDir = configured
    return () => Promise.resolve(configuredDir)
  }
  return async () => join(await findProjectRoot(process.cwd()), '.dsh/memory')
}

/**
 * Register the local filesystem memory provider for the lifetime of `ctx`.
 * @param ctx - Plugin context; the registration is disposed with it.
 * @param config - Store location and bounds configuration.
 * @throws when the bounds are not positive integers.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const maxEntryChars = config.maxEntryChars ?? DEFAULT_MAX_ENTRY_CHARS
  const maxListEntries = config.maxListEntries ?? DEFAULT_MAX_LIST_ENTRIES
  if (!Number.isSafeInteger(maxEntryChars) || maxEntryChars <= 0) {
    throw new TypeError(`memory-local: maxEntryChars must be a positive safe integer, got ${String(config.maxEntryChars)}`)
  }
  if (!Number.isSafeInteger(maxListEntries) || maxListEntries <= 0) {
    throw new TypeError(`memory-local: maxListEntries must be a positive safe integer, got ${String(config.maxListEntries)}`)
  }
  const store = new LocalMemoryStore({
    resolveDir: resolveStoreDir(config.dir),
    maxEntryChars,
    maxListEntries,
  })
  ctx.memory.registerProvider(store)
}
