# Memory

English | [中文](memory.zh.md)

Durable cross-session knowledge entries: what the `ctx.memory` seam stores, who owns storage, and what the model sees. The [memory capability seam Agent Note](../../.agents/notes/implemented/feature/2026-09-12-memory-capability-seam.md) owns the design decisions; this page records the contracts from [`packages/memory/`](../../packages/memory/README.md).

## The seam

`ctx.memory` holds exactly one `MemoryProvider`. The hub service itself performs no IO; every operation delegates to the registered provider, and operating without one throws the seam's `provider-missing` code instead of degrading to a no-op store.

| Field | Type | Meaning |
|---|---|---|
| `id` | `MemoryId` | Branded string assigned by the provider, stable across sessions. |
| `kind` | `'user' \| 'feedback' \| 'project' \| 'reference'` | Who the user is; corrections and confirmed approaches; project goals and constraints; pointers to external resources. Kinds guide recall framing and are not a permission boundary. |
| `content` | `string` | The remembered fact, self-contained prose a later session can use. |
| `createdAt` / `updatedAt` | `number` | Epoch milliseconds of the entry's creation and last change. |

The four operations are `record` (store one new entry), `list` (read everything, provider-ordered), `search` (case-insensitive content match), and `forget` (delete one entry, returning whether the id existed). Providers own identity allocation, bounds, and durability; a rejected operation leaves the stored set unchanged.

## The error contract

`MemoryError.code` is shared by the hub and every provider so consumers never import provider code. `duplicate-provider` and `provider-missing` are wiring failures thrown by the hub; `invalid-content` and `content-too-large` are record-input failures thrown by providers. The generated [configuration catalog](../config-catalog.md#deepseek-aidsh-memory-local) documents every accepted provider field.

## What the model sees

The consumer `dsh-tool-memory` registers `memory_save`, `memory_search`, `memory_list`, and `memory_forget` on `ctx.tools`, and injects one durable memory-index user message before the first step of a session when the store is non-empty. Index dedupe reads the session log itself, so resumes and forks never re-publish. Entries saved mid-session surface through tool results; the index refreshes on the next session. Timestamps render as ISO 8601 strings in tool results; the index renders one first-line summary per entry, truncated to the configured `indexLineMaxChars`.

## Where the data lives

The shipped provider `dsh-memory-local` stores one markdown file per entry under `<projectRoot>/.dsh/memory/entries/`, with frontmatter carrying identity and timestamps. The directory is the only source of truth: there is no index file, cache, or database to reconcile. Search is substring matching over content; there are no embeddings or ranking anywhere in the family.

## Related documentation

- [packages/memory group](../../packages/memory/README.md) — the package map.
- [Enable persistent memory](../user/guide/memory.md) — the user-facing setup guide.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxmemory--memory"></a>

### `ctx.memory` — `Memory`

The memory service. Registered as `ctx.memory` (one instance per context). A provider registers under Memory.registerProvider; every read and write delegates to it. With no provider registered, every operation throws MemoryError `provider-missing` — misconfiguration never silently degrades to a no-op store.

```ts cordis-catalog
/**
 * Register the memory provider. Throws {@link MemoryError}
 * `duplicate-provider` when a provider is already registered. Returns a
 * disposer; disposed with the calling fiber.
 * @param provider - The provider implementation to register.
 * @returns the disposer that unregisters the provider.
 */
registerProvider(provider: MemoryProvider): () => void

/**
 * Store one new memory entry.
 * @param input - The kind and content to store.
 * @returns the stored entry with its provider-assigned identity.
 */
record(input: MemoryRecordInput): Promise<MemoryEntry>

/**
 * Read every stored memory entry.
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
 * Delete one memory entry.
 * @param id - The entry to delete.
 * @returns `true` when the entry existed and was deleted, `false` when the id is unknown.
 */
forget(id: MemoryId): Promise<boolean>
```

Source: [`packages/memory/memory/src/index.ts`](../../packages/memory/memory/src/index.ts)
<!-- END GENERATED cordis-surface -->
