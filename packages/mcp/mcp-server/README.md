---
description: "The MCP server bridge (stdio): exposes the harness's registered tools to external MCP clients, for deployments serving dsh capabilities to other agents and maintainers extending the bridge."
kind: "package-reference"
---

# @deepseek-ai/dsh-mcp-server

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

`dsh-mcp-server` is the outward complement of [`dsh-mcp-client`](../mcp-client/README.md): it exposes the harness's own registered tools to external MCP clients over stdio, so another agent — Claude Code, Codex, or any MCP host — can drive dsh capabilities. One harness agent per process owns every served call; `tools/list` reports that agent's visible tools projected to standard JSON Schema, and `tools/call` runs the harness's guarded execution pipeline with the client's cancellation signal.

<a id="use-this-package"></a>
## Use this package

The shipped path is the `mcp` profile: `dsh --profile mcp` serves MCP until the client disconnects, with the composition owned by the [`dsh-mcp-app`](../../bundle/mcp-app/README.md) bundle. The wire rides on stdio; stdout carries MCP frames and nothing else.

| Field | Default | Meaning |
|---|---|---|
| `provider` / `model` | base profile's route | Provider route for the serving agent. |
| `serverName` | `deepseek-harness-mcp` | Name advertised at MCP initialize. |
| `serverVersion` | `0.0.1` | Version advertised at MCP initialize. |

From any MCP client, register the server with the same stdio command you use to start the profile. The served tools are the deployment-wide root set: every tool the base composition registers, including opt-in overlays the profile loads.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design philosophy

- **One agent per process.** The MCP protocol has no session concept matching a harness turn, so the bridge creates one root agent on first use and every client shares it; tool calls run through the same `ctx.tools.execute` pipeline, permissions, and sandbox policy as native calls.
- **Schema projection, not passthrough.** The dsh schema dialect carries `required` per property; `tools/list` projects it to standard JSON Schema with top-level `required` arrays recursively, so strict MCP clients never see harness dialect.
- **Failure is a value.** A failed tool call returns `isError` content; only wiring failures (unknown tool, disposed bridge) surface as protocol errors.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: lazy serving agent, MCP handlers, transport wiring, teardown |
| [`src/schema.ts`](src/schema.ts) | The recursive dsh-dialect → standard-JSON-Schema projection |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Tools subsystem reference](../../../docs/subsystems/tools.md) — the `ToolRuntime` contract whose tools the bridge serves.
- [MCP server bridge Agent Note](../../../.agents/notes/implemented/feature/2026-09-12-mcp-server-bridge.md) — the design, rejected alternatives, and validation contract.

## Model Experience

Indirectly, through the MCP clients that call the served tools; the bridge registers no prompt, schema, or section of its own.

#### KV Cache effect

No harness model request is affected by the bridge itself; tool calls it serves consume tokens through the same history as native calls.

## Known Limitations and Deferred Work

- **Tools only** — MCP resources and prompts are not served; the bridge exposes the tool registry alone.
- **One agent per process** — concurrent MCP clients share one harness agent and one session; there is no per-client session isolation or resume.
- **Approval-gated actions fail closed** — the bridge offers no interactive approval surface; a deployment that serves sensitive tools must configure a machine policy, or those calls fail.
- **No authentication** — stdio MCP trusts the local process that launched it; remote transports are out of scope.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

**Runtime invariant:** No companion is published. The bridge's model-visible surface is exactly the tool registry's own projection, pinned by the wire composition tests; no second observation exists to diverge.

</details>
