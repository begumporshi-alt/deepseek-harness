---
description: "The automation group map: durable application-scoped schedules that create or resume Sessions when due, for users and maintainers navigating the group."
kind: "package-group"
---

# automation/ — Cross-session automations

English | [中文](README.zh.md)

## Summary

The automation group lets the harness run scheduled work unattended. An automation pairs one trigger — a future instant, a fixed interval, or a cron expression in a named time zone — with one target: a fresh session or an existing one to resume. When due, the runtime submits the prompt into that session with automation provenance and records the turn's outcome. Records persist to one JSON store file, so schedules survive restarts; an un-run one-shot fires on load, and recurring triggers re-align after downtime. The service package owns scheduling and dispatch; the tool package exposes management to the model.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`automation/`](automation/README.md) | The automation runtime: durable record set, trigger math, due dispatch, and Session create/resume runs | `automation` |
| [`tool-automation/`](tool-automation/README.md) | Model-facing consumer: `automation_create` / `automation_list` / `automation_delete` tools | — (tools only) |

-----

<a id="related-documentation"></a>
## Related documentation

- [Automation subsystem](../../docs/subsystems/automation.md) — the authoritative contract for the runtime and its consumer.
- [Automation capability Agent Note](../../.agents/notes/implemented/feature/2026-09-12-automation-capability.md) — the design, rejected alternatives, and validation contract.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The runtime is the webhook pattern made durable: application-scoped records in an owned store file replace fire-and-forget rule invocations, and the single Session-creation transaction gains a resume path. Neither package publishes an invariant companion — the runtime is the only writer of every observable automation fact.

</details>
