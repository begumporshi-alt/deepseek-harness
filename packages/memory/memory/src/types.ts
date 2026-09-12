/**
 * Type vocabulary for the memory capability seam. This module contains only
 * types — no runtime code.
 * @module @deepseek-ai/dsh-memory/src/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Identifies one memory entry. Stable across sessions and restarts. */
export type MemoryId = Branded<'MemoryId'>

/**
 * What kind of knowledge one entry holds. The kind guides recall framing and
 * storage layout; it is not a permission boundary.
 * - `user` — who the user is: role, preferences, environment facts.
 * - `feedback` — corrections and confirmed approaches the user has given.
 * - `project` — goals, constraints, and decisions of the current project.
 * - `reference` — pointers to external resources the user cares about.
 */
export type MemoryKind = 'user' | 'feedback' | 'project' | 'reference'

/** One durable cross-session knowledge entry. */
export interface MemoryEntry {
  /** Stable entry identifier assigned by the provider. */
  readonly id: MemoryId
  /** What kind of knowledge this entry holds. */
  readonly kind: MemoryKind
  /** The remembered fact, self-contained prose a later session can use. */
  readonly content: string
  /** Epoch milliseconds when the entry was first recorded. */
  readonly createdAt: number
  /** Epoch milliseconds when the entry was last changed. */
  readonly updatedAt: number
}

/** Input for recording one new memory entry. */
export interface MemoryRecordInput {
  /** What kind of knowledge is being recorded. */
  readonly kind: MemoryKind
  /** The fact to remember, self-contained prose a later session can use. */
  readonly content: string
}

/**
 * One implementation of durable memory storage. Providers own the medium,
 * identifier allocation, bounds, and durability; the memory service owns
 * provider registration and failure loudness. All methods may reject; a
 * rejected operation must leave the stored set unchanged.
 */
export interface MemoryProvider {
  /** Registry identity of this provider, unique per registration scope. */
  readonly id: string
  /**
   * Store one new entry and return it with its provider-assigned identity.
   * @param input - The kind and content to store.
   * @returns the stored entry.
   */
  record(input: MemoryRecordInput): Promise<MemoryEntry>
  /**
   * Read every stored entry.
   * @returns all entries in provider-determined order.
   */
  list(): Promise<readonly MemoryEntry[]>
  /**
   * Read the stored entries matching a query.
   * @param query - Case-insensitive text matched against entry content.
   * @returns the matching entries in provider-determined order.
   */
  search(query: string): Promise<readonly MemoryEntry[]>
  /**
   * Delete one entry.
   * @param id - The entry to delete.
   * @returns `true` when the entry existed and was deleted, `false` when the id is unknown.
   */
  forget(id: MemoryId): Promise<boolean>
}
