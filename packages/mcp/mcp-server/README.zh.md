---
description: "MCP 服务器桥接（stdio）：将 harness 已注册的工具暴露给外部 MCP 客户端，面向将 dsh 能力提供给其他 agent（智能体）的部署，以及扩展该桥接的维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-mcp-server

[English](README.md) | 中文

## 目录

- [概述](#summary)
- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="summary"></a>
## 概述

`dsh-mcp-server` 是 [`dsh-mcp-client`](../mcp-client/README.zh.md) 的对外补充：它通过 stdio 将 harness 自身已注册的工具暴露给外部 MCP 客户端，让另一个 agent——Claude Code、Codex 或任何 MCP host——能够驱动 dsh 能力。每进程一个 harness agent 拥有每一次对外服务的调用；`tools/list` 将该 agent 的可见工具投影为标准 JSON Schema 后报告，`tools/call` 则携带客户端的取消信号运行 harness 带防护机制的执行流水线。

<a id="use-this-package"></a>
## 使用本包

随附路径是 `mcp` profile：`dsh --profile mcp` 在客户端断开前一直对外提供 MCP 服务，组合由 [`dsh-mcp-app`](../../bundle/mcp-app/README.zh.md) 组合包负责。线路基于 stdio；stdout 只承载 MCP 帧。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `provider` / `model` | base profile 的路由 | 对外服务 agent 的提供方路由。 |
| `serverName` | `deepseek-harness-mcp` | 在 MCP initialize 时通告的名称。 |
| `serverVersion` | `0.0.1` | 在 MCP initialize 时通告的版本。 |

在任何 MCP 客户端中，用你启动该 profile 的同一条 stdio 命令注册服务器。对外提供的工具是整个部署的根集合：base 组合注册的每一个工具，包括该 profile 加载的 opt-in overlay。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

### 设计理念

- **每进程一个 agent。** MCP 协议没有与 harness 轮次对应的会话概念，因此桥接在首次使用时创建一个根 agent，所有客户端共享它；工具调用经过与原生调用相同的 `ctx.tools.execute` 流水线、权限与沙箱策略。
- **Schema 投影，而非透传。** dsh schema 方言在每个属性上携带 `required`；`tools/list` 会将其递归投影为带顶层 `required` 数组的标准 JSON Schema，严格的 MCP 客户端绝不会看到 harness 方言。
- **失败即值。** 失败的工具调用返回 `isError` 内容；只有接线失败（未知工具、已 dispose（资源释放）的桥接）才会以协议错误的形式出现。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：惰性创建的对外服务 agent、MCP 处理器、传输接线、teardown |
| [`src/schema.ts`](src/schema.ts) | dsh 方言 → 标准 JSON Schema 的递归投影 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [工具子系统参考](../../../docs/subsystems/tools.zh.md)——桥接所服务工具的 `ToolRuntime` 约定。
- [MCP 服务器桥接 Agent Note](../../../.agents/notes/implemented/feature/2026-09-12-mcp-server-bridge.zh.md)——设计、被否决的备选方案与验证约定。

<a id="model-experience"></a>
## 模型体验

间接地，通过调用对外提供工具的 MCP 客户端；桥接本身不注册任何提示词、schema 或提示词段落。

#### KV Cache 影响

桥接本身不影响任何 harness 模型请求；它对外服务的工具调用通过与原生调用相同的历史消耗 token。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- **仅限工具**——不对外提供 MCP 资源与提示词；桥接只暴露工具注册表。
- **每进程一个 agent**——并发的 MCP 客户端共享一个 harness agent 与一个会话；没有按客户端的会话隔离或恢复。
- **需批准的动作失败关闭**——桥接不提供交互式批准面；对外提供敏感工具的部署必须配置机器策略，否则这些调用会失败。
- **无认证**——stdio MCP 信任启动它的本地进程；远程传输不在范围内。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

**Runtime invariant:** No companion is published. The bridge's model-visible surface is exactly the tool registry's own projection, pinned by the wire composition tests; no second observation exists to diverge.

</details>
