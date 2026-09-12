---
description: "Automation-only MCP stdio application profile for users and maintainers serving harness tools to external MCP clients."
kind: "package-bundle"
---

# `@deepseek-ai/dsh-mcp-app`

English | [中文](README.zh.md)

## Table of Contents

- [Summary](#summary)
- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="summary"></a>
## Summary

The automation-only MCP stdio application as a `dsh` profile bundle over [`dsh-base`](../base/README.md). Its patch sets the coding-agent persona and default model route, mounts an app-owned zero-option command provider, and starts [`dsh-mcp-server`](../../mcp/mcp-server/README.md) only after that provider accepts the invocation — `dsh --profile mcp --help` writes help and exits without claiming stdin or stdout.

<a id="use-this-package"></a>
## Use this package

`dsh --profile mcp` serves the harness tools over MCP stdio until the client disconnects; stdin EOF, SIGINT, and SIGTERM drain the serving agent before exit. Stdout is reserved for MCP frames. The shipped row creates the serving agent with `deepseek-official` and `deepseek-v4-flash`; a later patch can replace that row's complete config. The base profile owns adapters, tools, persistence, policy, settings, and credentials.

Register the server in any MCP client with the command that starts the profile; the client discovers the tool set over `tools/list`.

## Model Experience

Indirectly, through the MCP clients that call the served tools; the bundle registers no prompt, schema, or section of its own.

#### KV Cache effect

No harness model request is affected by the bundle itself.

## Known Limitations and Deferred Work

- **No interactive approval surface** — approval-gated tool calls fail closed unless the deployment configures a machine policy.
- **One serving agent per process** — see the [bridge limitations](../../mcp/mcp-server/README.md#known-limitations-and-deferred-work).

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

**Runtime invariant:** No companion is published. The bundle is composition wiring; the bridge it mounts owns every runtime contract and its tests.

</details>
