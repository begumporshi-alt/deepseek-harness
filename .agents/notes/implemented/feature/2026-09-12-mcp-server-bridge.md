# Agent Note: MCP server bridge

Status: implemented

English | [中文](2026-09-12-mcp-server-bridge.zh.md)

## Problem

The MCP capability in the harness was one-directional: `dsh-mcp-client` attaches external MCP servers so their tools reach the model, but nothing exposes the harness's own tools to external MCP clients. The gap audit's build order ranked this the highest-value remaining item — it turns every dsh capability into an ecosystem tool that other agents (Claude Code, Codex, any MCP host) can drive, and it is the cleanest answer for "use dsh tools from another product."

## Decision

Ship `packages/mcp/mcp-server` — the outward MCP bridge — plus `packages/bundle/mcp-app` and an `mcp` profile template, mirroring the ACP application's shape:

- The bridge uses the SDK's low-level `Server` with raw `ListToolsRequestSchema`/`CallToolRequestSchema` handlers. The high-level `McpServer` is zod-first and does not accept the harness's lossless-JSON dialect; the low-level API takes standard JSON Schema objects, which the bridge produces by projecting the dsh dialect (per-property `required` markers) to top-level `required` arrays recursively (`dshSchemaToMcp`).
- One root agent per process, created lazily on the first `tools/call`. MCP has no session concept matching a harness turn, and the served surface is the deployment's root tool set; every client shares one agent, and calls run through the same `ctx.tools.execute` pipeline — permissions, sandbox, and session logging included — as native calls.
- `tools/call` failures are values (`isError` content); only wiring failures (unknown tool, disposed bridge) surface as protocol errors. Client cancellation rides the request's abort signal.
- Stdout belongs to MCP; the `mcp` profile's startup provider publishes readiness only after command-line parsing (help exits without claiming stdio), copying `dsh-acp-app`'s structure so `dsh --profile mcp` is one command with no options.

The bridge mounts through an ordinary composition; no default profile changes, and `dsh --profile acp`/`sdk` are untouched.

## Validation contract

The keyless suite covers the schema projection (markers, nesting, oneOf branches, pre-existing arrays, scalars), the projection helpers, and a real wire composition: the bridge boots over the actual loop stack (test dependencies, JSONL persistence, token meter, agent loop, mock adapter) with the memory family's tools mounted, an `InMemoryTransport`-linked MCP `Client` performs `tools/list` (standard-schema inputs asserted), `tools/call` round-trips a durable entry to disk, unknown tools reject with a protocol error, and disposal closes the transport. Coverage is 100% per file. Remote CI contacts no external service.

## Alternatives considered

**Serve tools through the ACP bridge.** Rejected: ACP is a session-oriented agent protocol, not a tool-server protocol; MCP clients cannot speak it, and the tool-surface semantics (schema dialect, error values) differ.

**The high-level `McpServer` API.** Rejected for v1: its zod-first registration cannot express the harness's JSON-schema dialect without a lossy conversion in the other direction; the low-level `Server` accepts the projected schemas directly.

**Per-client agents.** Deferred: MCP `initialize` carries no workspace or session identity, so per-client isolation would invent a mapping with no protocol signal to key it on; one shared root agent matches what single-purpose tool servers do.

**HTTP transport.** Deferred: stdio covers the local-process trust model every current MCP host uses; remote serving needs an authentication story first.

## Consequences

Any MCP host can drive the deployment's tool surface, including first-party capabilities like the memory tools. Approval-gated actions fail closed (no interactive surface on stdio) — deployments serving sensitive tools must configure a machine policy. The shared agent means one session log per serving process. A future per-client or HTTP variant composes by replacing the transport and the agent-creation policy, both local to the bridge.
