# Automation

English | [中文](automation.zh.md)

Durable application-scoped schedules that create or resume Sessions when due: what `ctx.automation` stores, how runs execute, and what the model sees. The [automation capability Agent Note](../../.agents/notes/implemented/feature/2026-09-12-automation-capability.md) owns the design decisions; this page records the contracts from [`packages/automation/`](../../packages/automation/README.md).

## The runtime

`ctx.automation` holds one durable record set and one due driver. A record pairs a trigger with an action; when the earliest next due instant arrives, the driver executes one run and records its outcome. The runtime is application-scoped: records and the driver live at the process level, while every run lands in an ordinary root Session owned by the normal lifecycle.

| Trigger kind | Fields | Scheduling rule |
|---|---|---|
| `once` | `at` | Fires one future instant; a crash before the run fires it again on load. |
| `every` | `intervalSeconds` | Anchor-aligned fixed rate; a long gap costs one catch-up run, then re-aligns. |
| `cron` | `expression`, `timeZone?` | Five- or six-field cron expression evaluated in the named IANA zone. |

| Action kind | Fields | Run behavior |
|---|---|---|
| `new-session` | `cwd` | Creates a fresh root Session in the directory, submits the prompt, and disposes the handle after the run. |
| `resume-session` | `sessionId` | Reuses a live target in place; a cold target is resumed from the persistence root and disposed after the run. |

Every recurring trigger must space occurrences by at least 300 seconds; creation rejects denser schedules. The `resume-session` action must name a session that exists in the configured persistence root — creation fails loud rather than at run time.

## Delivery contract

At-least-once for one-shots: a `once` automation that was due while the process was down fires once on load. Recurring automations advance past missed occurrences without a burst. A run's outcome is recorded after the driven turn settles and the session log is flushed; a crash between the turn and the record write can repeat one run. Runs execute sequentially in wake order — a long-running session delays other due automations.

## What the model sees

The consumer `dsh-tool-automation` registers `automation_create`, `automation_list`, and `automation_delete` on `ctx.tools`. Creation takes one trigger (`at` as an ISO 8601 timestamp, `every_seconds`, or `cron` with an optional `time_zone`) and one optional target (`session_id` takes precedence over `cwd`; omitting both targets a fresh session in the process working directory). Each due run appends one user message with `automation` provenance — the automation's identity and a one-line notice — to the target session, so the model sees exactly the prompt it must act on. Errors surface as schema'd error values naming the rejected field.

## Where the data lives

The store is one JSON file — `<dsh home>/automations/automations.json` by default, or the configured `storePath` — holding the complete record set with a monotonic format version. Every mutation rewrites the whole file atomically (temporary file plus rename) through a serialized save chain; readers refuse other format versions. There is no run history beyond each record's latest settled run.

## Related documentation

- [packages/automation group](../../packages/automation/README.md) — the package map.
- [Enable automations](../user/guide/automations.md) — the user-facing setup guide.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxautomation--automationruntime"></a>

### `ctx.automation` — `AutomationRuntime`

The automation runtime: a durable record set, a single-flight due driver over segmented timers, and the public create/list/delete surface. Every mutation persists the complete state before the next due instant is armed.

```ts cordis-catalog
/**
 * Create one automation.
 * @param input - validated creation input; a `resume-session` action must
 * name a persisted Session.
 * @returns the stored record.
 * @throws {@link AutomationInputError} for invalid input.
 */
async create(input: AutomationCreateInput): Promise<AutomationRecord>

/**
 * List every stored record.
 * @returns the records in creation order.
 */
async list(): Promise<readonly AutomationRecord[]>

/**
 * Delete one stored record.
 * @param id - the automation to remove.
 * @returns whether a record was removed; `false` for an unknown id.
 */
async delete(id: AutomationId): Promise<boolean>
```

Source: [`packages/automation/automation/src/index.ts`](../../packages/automation/automation/src/index.ts)
<!-- END GENERATED cordis-surface -->
