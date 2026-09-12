/**
 * Memory capability seam (`ctx.memory`): the provider registry behind durable
 * cross-session knowledge entries. The hub itself performs no IO — the
 * registered provider owns the medium, identity allocation, and bounds.
 * Exactly one provider may be registered; operating without one fails loud.
 * @module @deepseek-ai/dsh-memory
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { MemoryError } from './error.ts'
import type { MemoryEntry, MemoryId, MemoryProvider, MemoryRecordInput } from './types.ts'

export { MemoryError } from './error.ts'
export type { MemoryErrorCode } from './error.ts'
export type { MemoryEntry, MemoryId, MemoryKind, MemoryProvider, MemoryRecordInput } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    memory: Memory
  }
}

/**
 * The memory service. Registered as `ctx.memory` (one instance per context).
 * A provider registers under {@link Memory.registerProvider}; every read and
 * write delegates to it. With no provider registered, every operation throws
 * {@link MemoryError} `provider-missing` — misconfiguration never silently
 * degrades to a no-op store.
 */
export class Memory extends Service {
  private provider: MemoryProvider | undefined

  constructor(ctx: Context) {
    super(ctx, 'memory')
  }

  /**
   * Register the memory provider. Throws {@link MemoryError}
   * `duplicate-provider` when a provider is already registered. Returns a
   * disposer; disposed with the calling fiber.
   * @param provider - The provider implementation to register.
   * @returns the disposer that unregisters the provider.
   */
  registerProvider(provider: MemoryProvider): () => void {
    if (this.provider !== undefined) {
      throw new MemoryError(
        'duplicate-provider',
        `a memory provider with id "${this.provider.id}" is already registered; memory keeps exactly one store`,
      )
    }
    this.provider = provider
    return () => {
      if (this.provider === provider) this.provider = undefined
    }
  }

  /**
   * Store one new memory entry.
   * @param input - The kind and content to store.
   * @returns the stored entry with its provider-assigned identity.
   */
  record(input: MemoryRecordInput): Promise<MemoryEntry> {
    return this.requireProvider().record(input)
  }

  /**
   * Read every stored memory entry.
   * @returns all entries in provider-determined order.
   */
  list(): Promise<readonly MemoryEntry[]> {
    return this.requireProvider().list()
  }

  /**
   * Read the stored entries matching a query.
   * @param query - Case-insensitive text matched against entry content.
   * @returns the matching entries in provider-determined order.
   */
  search(query: string): Promise<readonly MemoryEntry[]> {
    return this.requireProvider().search(query)
  }

  /**
   * Delete one memory entry.
   * @param id - The entry to delete.
   * @returns `true` when the entry existed and was deleted, `false` when the id is unknown.
   */
  forget(id: MemoryId): Promise<boolean> {
    return this.requireProvider().forget(id)
  }

  /**
   * Resolve the registered provider, failing loud when none is loaded.
   * @returns the registered provider.
   */
  private requireProvider(): MemoryProvider {
    if (this.provider === undefined) {
      throw new MemoryError(
        'provider-missing',
        'no memory provider is registered; load a provider plugin such as @deepseek-ai/dsh-memory-local',
      )
    }
    return this.provider
  }
}

// Service packages default-export their service class and nothing else
// plugin-shaped (packages/AGENTS.md): mixing a default export with a
// function-plugin `apply` makes the Loader drop the plugin namespace.
export default Memory
