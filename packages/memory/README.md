---
description: "The memory group map: durable cross-session knowledge entries through the ctx.memory seam, the local filesystem provider, and the model-facing tools, for users and maintainers navigating the group."
kind: "package-group"
---

# memory/ — memory capability family

English | [中文](README.zh.md)

## Summary

The memory family gives an agent durable knowledge that outlives any one session: facts about the user, feedback, project constraints, and reference pointers. `dsh-memory` defines the `ctx.memory` seam with exactly one registered provider; `dsh-memory-local` stores entries as markdown files under the project; `dsh-tool-memory` exposes the model-facing tools and publishes the once-per-session memory index. These packages are optional and host-side: none ships in a default profile, so memory stays off unless the composition loads the family.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`memory/`](memory/README.md) | Service Definition: the single-slot provider registry and shared error contract for `ctx.memory` | `ctx.memory` |
| [`memory-local/`](memory-local/README.md) | Filesystem provider: one markdown file per entry under a project directory | registers on `ctx.memory` |
| [`tool-memory/`](tool-memory/README.md) | Consumer: `memory_save` / `memory_search` / `memory_list` / `memory_forget` tools plus the session-start index section | registers on `ctx.tools` |

-----

<a id="related-documentation"></a>
## Related documentation

- [Memory subsystem](../../docs/subsystems/memory.md) — the authoritative seam, provider, and consumer contract.
- [Enable persistent memory](../../docs/user/guide/memory.md) — setup, configuration, and verification for the shipped overlay.
- [Capability seams](../../docs/architecture.md) — the Service Definition / Provider / Consumer split this family follows.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
