---
description: "The memory service (ctx.memory): the single-slot provider registry and shared error contract for durable cross-session entries, for deployments and plugin authors wiring a memory store."
kind: "package-reference"
---

# @deepseek-ai/dsh-memory

English | [中文](README.zh.md)

## Table of Contents

- [Summary](#summary)
- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="summary"></a>
## Summary

`dsh-memory` defines the memory capability seam: `ctx.memory` holds exactly one `MemoryProvider` and delegates `record`, `list`, `search`, and `forget` to it. The hub performs no IO — providers own the medium, identity allocation, and bounds. Operating without a provider fails loud on every operation, and a second registration fails loud instead of shadowing the first.

<a id="use-this-package"></a>
## Use this package

Load `dsh-memory` in any composition that should carry memory, and load exactly one provider plugin (such as `dsh-memory-local`) alongside it. Compositions without a provider still boot; every operation rejects with `MemoryError` `provider-missing` so consumers can distinguish wiring failures from storage failures.

### Error contract

`MemoryError.code` is the stable vocabulary consumers may switch on:

| Code | Thrown by | Meaning |
|---|---|---|
| `duplicate-provider` | hub | A provider is already registered; memory keeps exactly one store. |
| `provider-missing` | hub | No provider is registered. |
| `invalid-content` | provider | The record input is empty. |
| `content-too-large` | provider | The record input exceeds the provider's configured bound. |

Input errors live on the seam, not on any provider, so a consumer handles rejected records without importing provider code.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design philosophy

- **One store per context.** Two concurrent memory stores would make recall results depend on registration order; the single-slot registry rejects the second registration instead.
- **Loud over silent.** A missing provider is a composition error; every operation throws rather than degrading to a no-op store.
- **Providers own media.** The hub carries no storage semantics, so a remote or database provider can replace the filesystem without touching the contract.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The `Memory` service: single-slot registration, delegation, and loud failures |
| [`src/types.ts`](src/types.ts) | Entry, record-input, and provider vocabulary, including the branded `MemoryId` |
| [`src/error.ts`](src/error.ts) | The shared `MemoryError` code contract |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Memory subsystem](../../../docs/subsystems/memory.md) — the authoritative contract for the seam, provider, and consumers.
- [Memory capability seam Agent Note](../../../.agents/notes/implemented/feature/2026-09-12-memory-capability-seam.md) — the design, rejected alternatives, and validation contract.

-----

## Model Experience

Indirectly, through `dsh-tool-memory`, which renders saved and recalled entries as tool results and publishes the memory index while this service contributes no prompt or schema.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

These limits describe the seam's current scope; they are package constraints, not a backlog.

- **Single-slot registration only** — replacing a provider requires disposing the current registration first; there is no precedence chain or per-agent provider selection.
- **No registration observation** — the hub emits no event when a provider registers or disposes; consumers resolve the provider at call time.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

**Runtime invariant:** No companion is published. The single-slot registry rejects duplicate and missing providers directly at the operation site, so there is no independently observable state whose divergence a companion could catch.

</details>
