/**
 * Memory consumer for the model: the `memory_save` / `memory_search` /
 * `memory_list` / `memory_forget` tools plus the once-per-session memory
 * index section injected ahead of the first step.
 * @module @deepseek-ai/dsh-tool-memory
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { createMemoryIndexHandler } from './section.ts'
import { registerMemoryTools } from './tools.ts'

export { createMemoryIndexHandler, hasPublishedIndex, renderIndexLine, renderIndexMessage } from './section.ts'
export type { MemoryIndexSource } from './section.ts'
export { memoryErrorValue, registerMemoryTools } from './tools.ts'

/** Cordis function-plugin name. */
export const name = 'tool-memory'

/** Services required before the tools and the section listener register. */
export const inject = ['tools', 'memory']

/** Default maximum characters of entry content shown per index line. */
export const DEFAULT_INDEX_LINE_MAX_CHARS = 120

/** Consumer configuration. Invalid values fail plugin load. */
export interface Config {
  /** Maximum characters of entry content shown per index line. Defaults to 120. */
  indexLineMaxChars?: number
}

/** Schemastery validation for {@link Config}. */
export const Config: z<Config> = z.object({
  indexLineMaxChars: z.number(),
})

/**
 * Register the memory tools and the once-per-session index section for the
 * lifetime of `ctx`.
 * @param ctx - Plugin context; registrations are disposed with it.
 * @param config - Index rendering configuration.
 * @throws when the index line cap is not a positive integer.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const indexLineMaxChars = config.indexLineMaxChars ?? DEFAULT_INDEX_LINE_MAX_CHARS
  if (!Number.isSafeInteger(indexLineMaxChars) || indexLineMaxChars < 1) {
    throw new TypeError(`tool-memory: indexLineMaxChars must be a positive safe integer, got ${String(config.indexLineMaxChars)}`)
  }
  registerMemoryTools(ctx, ctx.memory)
  ctx.on('agent/pre-step', createMemoryIndexHandler(ctx.memory, indexLineMaxChars))
}
