# Connect curated MCP tool servers

English | [中文](mcp-overlays.zh.md)

These **default-off reference configurations** connect ready-to-use MCP tool servers to DSH through [`@deepseek-ai/dsh-mcp-client`](../../../packages/mcp/mcp-client/README.md). Pass one overlay with `--patch`, or merge its `insert` patch into a user patch layer as described in the [memory MCP guide](./mcp-memory.md). Nothing here ships in a default profile; omitting `--patch` keeps every server disabled.

These third-party configurations are provided as interoperability examples only. Their inclusion does not imply endorsement, recommendation, partnership, or ongoing support by DeepSeek.

DSH exposes each server's tools as `mcp__<serverName>__<tool>`; the transport, naming, reconnection, and environment-scrubbing contracts are owned by the [MCP client README](../../../packages/mcp/mcp-client/README.md). DSH never installs a server package or downloads a browser — each prerequisite below is explicit.

## Choose a server

| Server | Tested pin | Transport | Adds | Upstream prerequisite |
|---|---:|---|---|---|
| [Playwright MCP](https://github.com/microsoft/playwright-mcp) | `@playwright/mcp@0.0.80` | stdio | Browser automation as `mcp__playwright__*` tools | Node 22.18+, `npm install --global @playwright/mcp@0.0.80`, and a Chrome-family browser for tool calls |
| [Context7](https://context7.com) | hosted, `serverInfo.version` 4.1.0, verified 2026-09-12 | streamable-http | Library and API documentation lookup as `mcp__context7__*` tools | None; anonymous access is rate-limited |
| Memory systems | — | — | Persisted cross-session memory | [Memory MCP guide](./mcp-memory.md) |

## Browser automation (Playwright MCP)

```sh
npm install --global @playwright/mcp@0.0.80
dsh web --patch "$PWD/apps/cli/config/examples/mcp-overlays/playwright.cordis.yml"
```

The model receives the server's full `browser_*` tool surface — 24 tools at the tested pin, including navigate, snapshot, click, fill, screenshot, and tabs. Tool calls drive a real browser on this machine: opened pages, submitted forms, and downloads are real actions. Keep the active approval policy in mind when a session may touch accounts you care about.

## Documentation lookup (Context7)

```sh
dsh web --patch "$PWD/apps/cli/config/examples/mcp-overlays/context7.cordis.yml"
```

No local install: DSH connects to the hosted Streamable HTTP endpoint, which must already be reachable. Anonymous access is rate-limited. For authenticated access, copy the overlay and add a `headers` block that reads the key from the environment:

```yaml
        headers:
          X-Context7-API-Key: !!js process.env.CONTEXT7_API_KEY
```

Set `CONTEXT7_API_KEY` before starting DSH. The server also advertises prompts and resources; like every server behind this client, only its tools bridge ([known limitations](../../../packages/mcp/mcp-client/README.md#known-limitations-and-deferred-work)).

## Verify

Initial discovery is asynchronous — wait for the server's `mcp__...` tools to appear, then use one prompt per server:

1. Playwright: `Open https://example.com and take a snapshot of the page.` The model should call an `mcp__playwright__*` tool and describe the page.
2. Context7: `Use context7 to look up the current getting-started docs for <library>.` The model should call `mcp__context7__resolve-library-id` and then `mcp__context7__query-docs`, and the answer should reflect current documentation.

To connect any other MCP tool server, copy the generic row from the [memory MCP guide](./mcp-memory.md).
