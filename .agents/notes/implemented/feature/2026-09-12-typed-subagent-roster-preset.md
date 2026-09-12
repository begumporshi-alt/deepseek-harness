# Agent Note: Typed subagent roster preset

Status: implemented

English | [中文](2026-09-12-typed-subagent-roster-preset.zh.md)

## Problem

ZCode-class agent CLIs ship a typed subagent roster: named delegation targets (`bug-hunter`, `codebase-mapper`, `code-reviewer`) whose role prompt and tool grant are fixed in configuration, so the parent names the work instead of re-specifying the role on every delegation. DSH had every mechanism — the `agent-presets` roster, the `tool-subagent` plugin's per-instance `toolName`, `persona`, and `toolFilter` config, and a spawn provider declaring those capabilities — but shipped only generic delegation tools (`subagent`, `subagent_fork`) inside session presets. The gap was authored content, not product code.

## Decision

Ship a fifth preset, `research`, that exercises the typed-roster shape end to end:

- **Read-first session surface.** The preset composes an analysis agent: file reading and search (`tool-fs`, `tool-fs-search`), web search and fetch (`tool-web`), compaction, and delegation — no shell, no workflows, no goals.
- **Typed delegation rows.** Two `tool-subagent` instances in the delegation group fix the child's role in configuration: `researcher` (codebase and topic mapping, allow-list `read`/`read_image`/`grep`/`glob`/`web_search`/`web_fetch`) and `reviewer` (change and claim critique, allow-list `read`/`read_image`/`grep`/`glob`). Both run continuable through the spawn provider and carry personas that bind them to read-only reporting.
- **No default-surface change.** The preset joins the shipped root as a pickable `research` id (`order: 4`); no existing preset, profile, or default changes, so recorded-session snapshots and shipped token costs are untouched.

The session surface itself still lists `write`/`edit` in its catalog (they arrive with `tool-fs`'s suite); read-only enforcement holds where it matters — in the typed children, whose allow-lists the runtime strips before the child's prompt is ever assembled, and whose personas restate the constraint.

## Validation contract

The shipped-root suite lists the five-preset roster, reports the new preset healthy (no malformed reason), and parses its entry list through the shared schema. A focused test pins the typed-roster shape: both rows exist, both use the spawn provider with non-empty personas, every allow-listed name is a reading or search tool, and `write`, `edit`, and `bash` are absent. The web-fetch loop now covers `research` alongside the other tool-bearing Web presets.

## Alternatives considered

**Add typed rows to `standard`.** Rejected: every standard session's model-visible schema would grow by two tools, changing the default token surface and forcing snapshot re-recording for content that is a composition choice, not a product default.

**A separate `tool-subagent` configuration-only overlay.** Rejected: standing tool-subagent rows belong to a preset's agent plane, and an overlay patch cannot insert into a preset's private composition; the roster is the sanctioned authoring surface.

**Enforce read-only for the session too.** Deferred: `tool-fs` registers its mutation tools unconditionally; a read-only switch would be a product change to a core tool package. The typed children are read-only by construction today.

## Consequences

Users pick `research` for analysis sessions and get a delegation roster they can trust by name; deployments wanting their own typed roles copy the preset and edit the rows. Future typed presets (planner, tester) follow the same row shape without product changes. The preset's session surface keeps `write`/`edit` visible — documented here and in the preset file — until a read-only switch exists in `tool-fs`.
