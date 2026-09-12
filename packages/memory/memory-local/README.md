---
description: "The local filesystem memory provider for ctx.memory: durable markdown entries under a project directory with configured bounds, for deployments choosing a memory store and maintainers extending it."
kind: "package-reference"
---

# @deepseek-ai/dsh-memory-local

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

`dsh-memory-local` registers the local filesystem provider on `ctx.memory`. Each entry is one markdown file under the store directory with a minimal frontmatter header (`id`, `kind`, `createdAt`, `updatedAt`) and the remembered fact as the body. The entries directory is the only source of truth, writes are atomic with owner-only file mode, and reads are issued per call, so entries edited while the harness is stopped are visible on the next use.

<a id="use-this-package"></a>
## Use this package

Load `dsh-memory-local` together with `dsh-memory` and a consumer such as `dsh-tool-memory`.

```yaml
- id: memory
  name: '@deepseek-ai/dsh-memory'

- id: memory-local
  name: '@deepseek-ai/dsh-memory-local'
  config:
    maxEntryChars: 4000
    maxListEntries: 200
```

| Field | Default | Meaning |
|---|---|---|
| `dir` | `<projectRoot>/.dsh/memory` | Store directory; the project root is the nearest ancestor of the working directory containing `.git`. |
| `maxEntryChars` | `4000` | Maximum characters of content one entry may hold. |
| `maxListEntries` | `200` | Maximum entries returned by `list` and `search`, newest change first. |

Invalid bounds fail plugin load. Recording empty or oversized content rejects with the seam's `invalid-content` / `content-too-large` codes and leaves the stored set unchanged.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design philosophy

- **Files are the database.** One markdown file per entry keeps the store inspectable, diffable, and editable with ordinary tools; there is no second representation to keep consistent.
- **Bounds are configuration.** Entry size and result caps are validated `Config` fields, not hardcoded tunables.
- **Rejects change nothing.** A failed write or a rejected record leaves prior entries intact.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `Config` validation, project-root resolution, provider registration |
| [`src/store.ts`](src/store.ts) | `LocalMemoryStore`: entry files, id allocation, bounds, and the loud malformed-entry read |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Memory subsystem](../../../docs/subsystems/memory.md) — the seam contract this provider implements.
- [Enable persistent memory](../../../docs/user/guide/memory.md) — setup and verification.

-----

## Model Experience

None, as the provider stores entries outside any model request and contributes no prompt, tool schema, or section.

#### KV Cache effect

No model request carries provider state; invalidation is owned by the consumers that read it.

## Known Limitations and Deferred Work

- **Substring search only** — `search` is case-insensitive substring matching over entry content; there are no embeddings, ranking, or semantic recall.
- **Single-process store** — concurrent writers from multiple harness processes on one directory are not locked; the store assumes one active harness per project directory.
- **Malformed entries fail reads** — an entry file with broken frontmatter fails the whole `list`/`search` read loudly, naming the file, rather than being skipped.
- **Entries are append-and-forget** — there is no update operation; changing a fact means forgetting the entry and recording a new one.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

**Runtime invariant:** No companion is published. The entries directory is the only representation of the store, so there is no second observation of the same data that could diverge from it.

</details>
