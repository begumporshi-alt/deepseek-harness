# Agent Note: Automation capability

Status: implemented

English | [中文](2026-09-12-automation-capability.zh.md)

## Problem

ZCode-class agent CLIs carry cross-session automations: the model schedules future or recurring work (cron expressions, one-shot instants) that survives restarts and runs a prompt in a fresh or resumed session. DSH had `dsh-schedule` — session-local reminders delivered as in-conversation messages — and `dsh-jobs` — an in-process live work registry — but nothing durable and application-scoped that could create or resume a Session on a timer. The gap audit's build order ranked this item 4; the webhook family had the right Session-creation shape but is deliberately fire-and-forget, so the missing pieces were the durable store, the trigger vocabulary, and a resume path.

## Decision

Ship a `packages/automation/` family with the capability's roles:

- `@deepseek-ai/dsh-automation` — the Service Definition and runtime: `ctx.automation` holds one durable record set in a JSON store file (atomic whole-file writes through a serialized save chain, monotonic format version) and one single-flight due driver over segmented timers. Triggers are `once` (a future instant), `every` (an anchor-aligned fixed rate), and `cron` (a five- or six-field expression in a named IANA zone, evaluated by the maintained `croner` dependency — nothing cron-like existed in-repo). Actions are `new-session` (create a root Session in a directory) and `resume-session` (reuse a live target in place, or resume a cold one from the persistence root). Every recurring trigger must space occurrences by at least 300 seconds, mirroring the schedule family's floor.
- `@deepseek-ai/dsh-tool-automation` — the consumer: `automation_create` / `automation_list` / `automation_delete` tools with flat trigger arguments (`at` ISO 8601, `every_seconds`, `cron` + `time_zone`) and an optional target (`session_id` over `cwd`, defaulting to a fresh session in the working directory).

A run resolves the model route at run start (the current default-model selection, or the record's explicit route), creates or resumes the target, submits the prompt with a new `MessageSourceMap` `automation` kind, awaits idle, flushes, derives the outcome from the durable `turn/end` reason, and disposes any handle it owns — a live reused target is never disposed. Runs execute sequentially in wake order inside `ctx.agents.withoutInitiator`. Delivery is at-least-once for one-shots (an un-run past `at` fires on load) and anchor-advance for recurring triggers (a long gap costs at most one catch-up run). The family ships as a default-off overlay (`apps/cli/config/examples/automations/cordis.yml`); no default profile changes, so recorded-session snapshots are untouched.

## Validation contract

The keyless suite covers the domain (trigger validation including cron density and impossible schedules, next-due derivation, catch-up, durable decoding of every field), the store (round-trips, atomic writes, serialized saves, format rejection, non-ENOENT rethrows), the run executor against stub contexts (outcome derivation, failure containment, abort rethrow, cleanup warnings), the runtime over the real loop stack (due dispatch with provenance, failed turns, live reuse, cold resume, restart catch-up, deletion, re-arm ranking, persist-failure containment, teardown), and the tools (trigger selection, target precedence, view projection, error mapping). One justified v8 pragma covers croner's non-Error rejection fallback, which cannot be produced by the library.

## Alternatives considered

**Extend `dsh-schedule` to application scope.** Rejected: its durability substrate is the session event log and its delivery model is hard-bound to one live session (`session-local` delivery mode); an application-scoped store and a host-scoped dispatcher would replace nearly all of it while keeping the name misleading.

**Reuse the webhook runtime with a durable front.** Rejected: the webhook's fire-and-forget contract (no queue, no replay, no retry) is a recorded decision serving rule authors; automations need exactly the statefulness that contract excludes, and merging both would weaken the webhook's teardown guarantees.

**Event-source automations into the session log like schedule changes.** Rejected: automations are not session data — they outlive every session they target and must load before any session exists. An owned store file keeps the record set readable and writable without a session context.

**Per-client agents or concurrent runs.** Rejected for v1: one sequential driver keeps due handling predictable and avoids stampedes; the cost (a long run delays other due automations) is documented as a known limitation.

## Consequences

The model can now schedule work that outlives the conversation, targeting either fresh sessions or a specific session it is told to continue; removing the overlay removes the capability with zero product-code involvement. The store is one JSON file per configured path — concurrent processes pointed at one file have no cross-process lease. Cron parsing is a new direct runtime dependency (`croner`, MIT, zero dependencies), recorded in the third-party notices. Future trigger kinds (calendar rules, webhooks as triggers) and actions join through the same record vocabulary without touching the driver.
