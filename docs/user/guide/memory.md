# Enable persistent memory

English | [中文](memory.zh.md)

These **default-off overlay configurations** give DSH durable memory across sessions: facts about you, your feedback, and your project survive into every future session. Memory uses first-party packages — no third-party service — and stores one markdown file per entry under the project's `.dsh/memory/` directory.

## Enable one

```sh
dsh web --patch "$PWD/apps/cli/config/examples/memory/cordis.yml"
```

The overlay loads the memory service, the local filesystem provider, and the model-facing tools in one patch. Nothing is enabled in any default profile; omitting `--patch` keeps memory off. To keep the selection across runs, merge the overlay's `insert` patch into a user patch layer as described in the [memory MCP guide](./mcp-memory.md) — the layering instructions are the same.

## What the model gets

Once enabled, the model sees four tools — `memory_save`, `memory_search`, `memory_list`, and `memory_forget` — and, from the second session on, an index of remembered facts injected at session start. Use one prompt per capability to verify:

1. In session A, ask: `Remember that my validation drink is lapsang-<unique suffix>.` The model should call `memory_save`.
2. Open session B in the same project directory (a new session, not a Host restart). The session-start index should list the fact.
3. In session B, ask: `What is my validation drink? Check memory.` The model should call `memory_search` or `memory_list` and answer from the entry.

## Where the data lives

Each entry is one markdown file with a small frontmatter header under `<projectRoot>/.dsh/memory/entries/`. You can read entries with any editor; deleted or edited files are picked up on the next read. Entries are capped (4,000 characters per entry, 200 results per listing by default) and configurable through the overlay's `config` block — every accepted field is in the [configuration catalog](../../config-catalog.md#deepseek-aidsh-memory-local).

Memory is project-scoped: the store lives under the nearest `.git` ancestor of the working directory, so different projects keep separate memories.

## Known boundaries

Search is case-insensitive substring matching, not semantic recall. The session-start index publishes once per session; facts saved mid-session appear through tool results and enter the index next session. To remove the capability, stop passing the overlay.
