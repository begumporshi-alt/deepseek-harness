---
description: "The automation runtime (ctx.automation): durable application-scoped schedules that create or resume Sessions when due, for deployments and plugin authors wiring scheduled work."
kind: "package-reference"
---

# @deepseek-ai/dsh-automation

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

`dsh-automation` owns `ctx.automation`: a durable record set of scheduled automations. Each automation pairs one trigger — a future instant, a fixed interval, or a cron expression in a named time zone — with one action: create a fresh root Session or resume an existing one, submit the prompt, and await the driven turn. Records persist to one JSON store file that survives restarts; an un-run past one-shot fires on load, and recurring triggers re-align after downtime at the cost of at most one catch-up run.

<a id="use-this-package"></a>
## Use this package

Load `dsh-automation` in any long-lived composition that should run scheduled work, and load `dsh-tool-automation` alongside it so the model can create, list, and delete automations through tools. The runtime requires the agent registry, the default-model selection, the session store, and a session persistence provider; compositions missing any of these fail at load.

### Configuration

| Field | Type | Default | Meaning |
|---|---|---|---|
| `storePath` | `string` | `<dsh home>/automations/automations.json` | Absolute path of the durable store file. |

### Trigger rules

| Kind | Fields | Scheduling rule |
|---|---|---|
| `once` | `at` | Fires one future instant; a crash before the run fires it again on load. |
| `every` | `intervalSeconds` | Anchor-aligned fixed rate; a long gap costs one catch-up run, then re-aligns. |
| `cron` | `expression`, `timeZone?` | Five- or six-field cron expression evaluated in the named IANA zone. |

Every recurring trigger must space occurrences by at least 300 seconds; creation rejects denser schedules.

### Delivery contract

At-least-once for one-shots: a `once` automation that was due while the process was down fires once on load. Recurring automations advance past missed occurrences without a burst. A run's outcome is recorded after the driven turn settles and the session log is flushed; a crash between the turn and the record write can repeat one run.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design philosophy

- **Application scope, Session targets.** The record set and the driver live at the process level, while every run lands in an ordinary root Session owned by the normal lifecycle.
- **Runs are transactions.** A run creates or resumes its target, submits the prompt with `automation` provenance, awaits idle, flushes, derives the outcome from the durable `turn/end`, and disposes any handle it owns. A live target agent is reused in place and never disposed.
- **One driver, no stampede.** Due records run sequentially in one single-flight wake pass; a wake arriving mid-pass defers to exactly one more pass.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The `AutomationRuntime` service: record set, timer loop, public create/list/delete, teardown |
| [`src/domain.ts`](src/domain.ts) | Pure trigger math, validation, catch-up derivation, and durable-record decoding |
| [`src/store.ts`](src/store.ts) | The JSON store file: atomic writes, serialized saves, version-gated reads |
| [`src/run.ts`](src/run.ts) | One run: create or resume the target, submit, await, summarize, dispose |
| [`src/types.ts`](src/types.ts) | Record, trigger, action, and run vocabulary, including the branded `AutomationId` and the `MessageSourceMap` provenance kind |
| [`src/brand.ts`](src/brand.ts) | The branded `AutomationId` |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Automation subsystem](../../../docs/subsystems/automation.md) — the authoritative contract for the runtime and its consumer.
- [Automation capability Agent Note](../../../.agents/notes/implemented/feature/2026-09-12-automation-capability.md) — the design, rejected alternatives, and validation contract.

-----

## Model Experience

Indirectly, through `dsh-tool-automation`, which exposes automation management as tool results while this service contributes no prompt or schema.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

These limits describe the runtime's current scope; they are package constraints, not a backlog.

- **Sequential runs** — due automations run one at a time in wake order; a long-running session delays other due automations.
- **No pause or run-now** — records are created, listed, and deleted; pausing and immediate manual runs are deferred.
- **Store writes are whole-file** — every mutation rewrites the complete record set; the store is bounded by the record count, not the run history.
- **One process per store** — concurrent processes pointed at one store file have no cross-process lease; last write wins.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

**Runtime invariant:** No companion is published. The runtime is the only writer of both the in-memory record set and the store file at the same call sites, so no independently observable state exists whose divergence a companion could catch.

</details>
