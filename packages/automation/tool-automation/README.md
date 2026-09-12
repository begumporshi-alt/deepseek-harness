---
description: "Automation consumer for the model: the automation_create, automation_list, and automation_delete tools over ctx.automation, for compositions exposing scheduled work to the agent."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-automation

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

`dsh-tool-automation` registers the `automation_create`, `automation_list`, and `automation_delete` tools on `ctx.tools`. The model describes one schedule — a future instant, an interval, or a cron expression — and one target: a fresh session (the calling working directory by default, or an explicit one) or an existing session to resume. Errors surface as schema'd error values so the model can correct its own input; a rejected creation names the exact field.

<a id="use-this-package"></a>
## Use this package

Load `dsh-tool-automation` after `dsh-automation`; the tools register for the plugin's lifetime and delegate every operation to `ctx.automation`.

### Tool surface

| Tool | Parameters | Result |
|---|---|---|
| `automation_create` | `title`, `prompt`, exactly one of `at` / `every_seconds` / `cron` (with optional `time_zone`), optional `cwd` or `session_id` | The stored record, with trigger, target, and next due instant |
| `automation_list` | — | Every stored record with its latest run outcome |
| `automation_delete` | `id` | Whether a record was removed |

The `at` parameter is an ISO 8601 timestamp; `every_seconds` and cron occurrences must space at least 300 seconds apart. `session_id` takes precedence over `cwd`, and omitting both targets a fresh session in the process working directory.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design philosophy

- **Flat tool arguments.** Exactly-one-of trigger selection is validated in the tool layer and reported as `invalid_input`, mirroring the schedule tools' surface.
- **No scheduling logic here.** Every rule — density floors, future instants, unknown sessions — lives in the service; the tools only translate flat arguments into the service's trigger and action shapes.

### Source map

| File | Role |
|---|---|
| [`src/tools.ts`](src/tools.ts) | The three tool definitions, trigger selection, view projection, and error mapping |
| [`src/index.ts`](src/index.ts) | The plugin wiring that registers the tools against `ctx.automation` |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Automation subsystem](../../../docs/subsystems/automation.md) — the authoritative contract for the runtime and its consumer.
- [Automation capability Agent Note](../../../.agents/notes/implemented/feature/2026-09-12-automation-capability.md) — the design, rejected alternatives, and validation contract.

-----

## Model Experience

### Automation tools

#### What the model sees

The tools add three tool schemas to the model's request payload, and each due automation run appends one `user/message` with `automation` provenance to the target session; the model sees the prompt it must act on with a one-line notice of its origin.

#### Token effect

Three fixed tool schemas while loaded, plus one user message per run in the target session.

#### KV Cache effect

The tool schemas extend every request prefix; each run's user message appends after the prior turn boundary.

## Known Limitations and Deferred Work

These limits describe the consumer's current scope; they are package constraints, not a backlog.

- **No model route parameter** — the tools create automations without an explicit model selection; every run follows the current default-model selection at run time.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

**Runtime invariant:** No companion is published. The tools are a stateless projection over `ctx.automation`, whose own service is the single writer of every observable automation fact.

</details>
