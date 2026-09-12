# Agent Note: Memory capability seam

Status: implemented

English | [中文](2026-09-12-memory-capability-seam.zh.md)

## Problem

ZCode-class agent CLIs carry a persistent cross-session memory: typed facts about the user, feedback, and the project, loaded into context at session start and writable by the model. DSH had no first-party memory at all — only session-log search tools, third-party memory MCP servers, and the workspace-as-memory convention. The gap audit's build order ranked this the highest-value first-party gap. Waiting for a third-party MCP memory row as the permanent answer would keep core continuity behind an optional external service with its own storage model.

## Decision

Ship a `packages/memory/` capability family with the seam's three roles:

- `@deepseek-ai/dsh-memory` — the Service Definition: `ctx.memory` holds exactly one `MemoryProvider` and delegates `record` / `list` / `search` / `forget`. Entries are `{ id: MemoryId (branded), kind: 'user' | 'feedback' | 'project' | 'reference', content, createdAt, updatedAt }`. The hub performs no IO; operating without a provider throws `provider-missing` on every operation, and a second registration throws `duplicate-provider`.
- `@deepseek-ai/dsh-memory-local` — the shipped provider: one markdown file per entry under `<projectRoot>/.dsh/memory/entries/` with frontmatter (`id`, `kind`, `createdAt`, `updatedAt`), atomic owner-only writes, configurable bounds (`maxEntryChars` 4000, `maxListEntries` 200), substring search, and loud failures on malformed entry files.
- `@deepseek-ai/dsh-tool-memory` — the consumer: `memory_save` / `memory_search` / `memory_list` / `memory_forget` tools plus a once-per-session memory-index section injected through the `agent/pre-step` waterfall, deduped against the durable session log (`memory-index` message source).

The record-input error codes (`invalid-content`, `content-too-large`) live on the seam, not the provider, so the consumer maps failures without importing provider code. The family ships as a default-off overlay (`apps/cli/config/examples/memory/cordis.yml`); no default profile changes, so recorded-session snapshots and shipped token costs are untouched. Cross-session data deliberately stays out of `SessionEventMap` — memory is not model-visible session history, and the "model-visible ⟺ logged" invariant is preserved because everything the model does see (tool results, the index message) is logged as usual.

## Validation contract

The keyless suite covers the service (loud wiring failures, delegation, disposal), the store (round-trip, bounds, ordering, malformed-entry loudness, single dir resolution), the section (log-based dedupe, truncation, reject pass-through, provider-missing degradation), and a real Loader composition booting `cordis.yml` through the Loader with the memory tools executed against a temp store, including the provider-missing composition. Remote CI contacts no external service; the store is pure local filesystem.

## Alternatives considered

**Build memory on the storage-domain KV seam.** Rejected for v1: memory entries are human-readable, human-editable documents, and a file-per-entry store keeps that property; the domain layer would add schema and notification machinery no current consumer needs.

**Have the agent maintain a MEMORY.md index file directly.** Rejected: a hand-edited index is a second representation of the same facts and drifts; the injected index is rendered from the entries at read time, so there is nothing to reconcile.

**Make the index a session event.** Rejected: the index is derived from cross-session data, not session history; publishing it as a session event would fork the truth and complicate replay for no consumer benefit.

**Semantic/embedding recall.** Deferred: substring search covers the current need; a provider that owns embeddings can join through the same seam.

## Consequences

Every session in an enabled composition starts with the remembered facts and can extend them; removing the overlay removes the capability with zero product-code involvement. The store is one harness process per project directory — concurrent multi-process writers are not locked. Future providers (remote, embedded) join by registering on `ctx.memory` without touching the consumer.
