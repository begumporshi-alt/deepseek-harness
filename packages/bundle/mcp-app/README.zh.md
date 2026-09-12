---
description: "面向将 harness 工具提供给外部 MCP 客户端的用户与维护者，说明纯自动化 MCP stdio 应用 profile。"
kind: "package-bundle"
---

# `@deepseek-ai/dsh-mcp-app`

[English](README.md) | 中文

## 目录

- [概述](#summary)
- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="summary"></a>
## 概述

以 [`dsh-base`](../base/README.zh.md) 为基础的纯自动化 MCP stdio 应用 `dsh` profile 组合包。其 patch 设置 coding agent（编程智能体）persona 与默认模型路由、挂载应用自有的零选项命令提供方，并且只在该提供方接受调用后启动 [`dsh-mcp-server`](../../mcp/mcp-server/README.zh.md)。因此，`dsh --profile mcp --help` 会写出 help 并退出，不会占用 stdin 或 stdout。

<a id="use-this-package"></a>
## 使用本包

`dsh --profile mcp` 通过 MCP stdio 对外提供 harness 工具，直到客户端断开；stdin EOF、SIGINT 与 SIGTERM 会在退出前排空对外服务 agent。Stdout 保留给 MCP 帧。随附配置项使用 `deepseek-official` 与 `deepseek-v4-flash` 创建对外服务 agent；后续 patch 可以替换该配置项的完整配置。base profile 负责适配器、工具、持久化、策略、设置与凭据。

在任何 MCP 客户端中用启动该 profile 的命令注册服务器；客户端通过 `tools/list` 发现工具集合。

<a id="model-experience"></a>
## 模型体验

间接地，通过调用对外提供工具的 MCP 客户端；组合包本身不注册任何提示词、schema 或提示词段落。

#### KV Cache 影响

组合包本身不影响任何 harness 模型请求。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- **无交互式批准面**——除非部署配置了机器策略，否则需批准的工具调用会失败关闭。
- **每进程一个对外服务 agent**——参见[桥接限制](../../mcp/mcp-server/README.zh.md#known-limitations-and-deferred-work)。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

**Runtime invariant:** No companion is published. The bundle is composition wiring; the bridge it mounts owns every runtime contract and its tests.

</details>
