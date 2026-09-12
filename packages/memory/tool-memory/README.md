---
description: "The model-facing memory consumer: memory_save/search/list/forget tools over ctx.memory plus the once-per-session memory index section, for deployments and maintainers shaping what the model sees."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-memory

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

`dsh-tool-memory` turns `ctx.memory` into model-visible capability: four tools (`memory_save`, `memory_search`, `memory_list`, `memory_forget`) registered on `ctx.tools`, and a durable memory-index section injected ahead of the first step of each session. The tools return schema'd error values instead of throwing, so the model can correct its own input; a missing provider degrades the section to no injection while the tools keep surfacing the wiring failure.

<a id="use-this-package"></a>
## Use this package

Load `dsh-tool-memory` together with `dsh-memory` and one provider.

```yaml
- id: tool-memory
  name: '@deepseek-ai/dsh-tool-memory'
  config:
    indexLineMaxChars: 120
```

| Field | Default | Meaning |
|---|---|---|
| `indexLineMaxChars` | `120` | Maximum characters of entry content shown per index line. |

Invalid values fail plugin load.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design philosophy

- **The session log is the dedupe authority.** Index publication scans durable history, so resumes and forks never re-publish, and the injected content stays reproducible from the log.
- **Errors are values.** Rejected records map onto the schema'd error vocabulary (`invalid_content`, `content_too_large`, `provider_unavailable`, `internal_error`) so the model can adapt without a failed tool round-trip.
- **Providers stay behind the seam.** The consumer imports no provider; it catches `MemoryError` codes only.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `Config` validation, tool registration, pre-step listener |
| [`src/tools.ts`](src/tools.ts) | The four tools, output schemas, and the error-value mapping |
| [`src/section.ts`](src/section.ts) | Index rendering, session-log dedupe, and the pre-step handler |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Memory subsystem](../../../docs/subsystems/memory.md) — the seam contract this consumer renders.
- [Enable persistent memory](../../../docs/user/guide/memory.md) — setup and verification.

<a id="model-experience"></a>
## Model Experience

### Memory tools

#### What the model sees

Four tools whose schemas and results are pinned in the generated [tool catalog](../../../docs/tool-catalog.md): `memory_save` returns the saved entry with an ISO-string timestamp view; `memory_search` and `memory_list` return entry lists, newest change first, bounded by the provider; `memory_forget` returns whether the id existed. Rejected operations return one of the schema'd error values instead of failing the call.

#### Token effect

Tool schemas enter every request while the tools are registered. Results and error values are retained in history until compaction.

#### KV Cache effect

Append-only. The schema prefix stays stable while the tool set is unchanged; the registry owns any replacement on reload.

### Session-start memory index

#### What the model sees

A durable user message injected before the first step of a session when the store holds at least one entry and no index is published yet:

##### Verbatim text for this field

```markdown
<system-reminder>
Persistent project memory is available. Facts remembered from earlier sessions:

- [user] {first line of one entry per line, truncated to indexLineMaxChars characters with an ellipsis}

Record facts worth carrying into future sessions with `memory_save`. Check `memory_search` or `memory_list` before asking the user for information that may already be remembered.
</system-reminder>
```

#### Token effect

One bounded message per session, proportional to the entry count and the per-line cap; retained in history until compaction.

#### KV Cache effect

Append-only; the message follows the reusable request prefix and never replaces earlier content.

## Known Limitations and Deferred Work

- **One publication per session** — entries saved mid-session are visible through tool results only; the injected index refreshes on the next session, fork, or resume.
- **No semantic search** — the tools expose the provider's substring search; ranking and embeddings are provider concerns that no shipped provider offers yet.
- **Silent section degradation** — with no provider registered, the index is simply absent; only the tools tell the model memory is unavailable.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

**Runtime invariant:** No companion is published. The model-visible surfaces (tool results and the index section) are pinned by the Loader-composition test and the section unit tests, and index dedupe reads the same session log the loop records, so no second observation exists to diverge.

</details>
