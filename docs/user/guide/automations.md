# Enable automations

English | [中文](automations.zh.md)

These **default-off overlay configurations** give DSH scheduled work that survives restarts: the model can create automations that run a prompt on a timer — in a fresh session or by resuming an existing one. Automations use first-party packages — no external scheduler — and store every record in one JSON file under the dsh home directory.

## Enable one

```sh
dsh web --patch "$PWD/apps/cli/config/examples/automations/cordis.yml"
```

The overlay loads the automation runtime and the model-facing tools in one patch. Nothing is enabled in any default profile; omitting `--patch` keeps automations off. To keep the selection across runs, merge the overlay's `insert` patch into a user patch layer as described in the [MCP overlays guide](./mcp-overlays.md) — the layering instructions are the same.

Because due runs execute inside the profile's process, the automation schedule only advances while that process runs; restarts catch up un-run one-shots and re-align recurring triggers.

## What the model gets

Once enabled, the model sees three tools — `automation_create`, `automation_list`, and `automation_delete`. Use one prompt per capability to verify:

1. Ask: `Every five minutes, summarize nothing but reply with the word tick.` The model should call `automation_create` with `every_seconds: 300` (the minimum interval).
2. Wait for one interval and ask: `List the automations.` The model should call `automation_list` and report the latest run outcome.
3. Ask: `Delete the tick automation.` The model should call `automation_delete`.

Cron expressions (`30 9 * * mon-fri`, with an optional IANA `time_zone`) and one-shot ISO 8601 instants are the other trigger kinds. A `resume-session` target keeps one conversation progressing on a schedule; the default target starts a fresh session in the working directory.

## Where the data lives

The store is one JSON file — `~/.dsh/automations/automations.json` by default — holding every record with its trigger, target, and latest run outcome. Each run creates or resumes an ordinary session whose log lands in the normal sessions directory, so the run's transcript is inspectable with any session tooling. The store path is configurable through the overlay's `config` block — every accepted field is in the [configuration catalog](../../config-catalog.md#deepseek-aidsh-automation).

## Known boundaries

Recurring triggers must space occurrences by at least 300 seconds. Runs execute sequentially, so a long-running session delays other due automations. The schedule advances only while the profile's process runs; nothing wakes a stopped host. To remove the capability, stop passing the overlay.
