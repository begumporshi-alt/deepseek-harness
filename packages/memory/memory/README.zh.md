---
description: "记忆服务 (ctx.memory)：跨会话持久条目的单槽提供方注册表与共享错误契约，面向为记忆存储接线的部署方与插件作者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-memory

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

`dsh-memory` 定义记忆 capability seam：`ctx.memory` 持有且仅持有一个 `MemoryProvider`，并把 `record`、`list`、`search` 与 `forget` 委托给它。hub 自身不做任何 IO——存储介质、身份分配与上限都归提供方所有。在没有提供方的情况下运行时，每个操作都会响亮失败；第二次注册也会响亮失败，而不是遮蔽第一次注册。

<a id="use-this-package"></a>
## 使用本包

在需要携带记忆的任何组合中加载 `dsh-memory`，并同时加载恰好一个提供方插件（例如 `dsh-memory-local`）。没有提供方的组合仍能启动；每个操作都会以 `MemoryError` 的 `provider-missing` 代码拒绝，因此消费者可以区分接线失败与存储失败。

### 错误契约

`MemoryError.code` 是消费者可以据以 switch 的稳定词汇：

| 代码 | 抛出方 | 含义 |
|---|---|---|
| `duplicate-provider` | hub | 已有提供方注册；记忆始终只保留一个存储。 |
| `provider-missing` | hub | 没有提供方注册。 |
| `invalid-content` | 提供方 | record 输入为空。 |
| `content-too-large` | 提供方 | record 输入超过提供方配置的上限。 |

输入错误位于 seam 上，而不属于任何提供方，因此消费者无需导入提供方代码即可处理被拒绝的记录。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

### 设计哲学

- **每个 context 一个存储。** 两个并发的记忆存储会让回忆结果取决于注册顺序；单槽注册表改为拒绝第二次注册。
- **响亮胜过静默。** 缺少提供方是组合错误；每个操作都抛出异常，而不是退化为无操作的空存储。
- **介质归提供方所有。** hub 不携带任何存储语义，因此远程或数据库提供方可以在不触碰契约的情况下替换文件系统。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | `Memory` 服务：单槽注册、委托与响亮失败 |
| [`src/types.ts`](src/types.ts) | 条目、record 输入与提供方词汇，包括品牌化的 `MemoryId` |
| [`src/error.ts`](src/error.ts) | 共享的 `MemoryError` 代码契约 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [记忆子系统](../../../docs/subsystems/memory.zh.md)——seam、提供方与消费者的权威契约。
- [记忆 capability seam Agent Note](../../../.agents/notes/implemented/feature/2026-09-12-memory-capability-seam.zh.md)——设计、被否决的备选方案与验证契约。

-----

<a id="model-experience"></a>
## 模型体验

间接生效：通过 `dsh-tool-memory`，它把已保存与已召回的条目渲染为工具结果并发布记忆索引，而本服务不贡献任何提示词或 schema。

#### KV Cache 影响

无直接失效；请求前缀的任何变更由对应的消费者负责。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>



这些限制描述 seam 当前的范围；它们是包约束，而不是任务积压。

- **仅支持单槽注册**——替换提供方需要先 dispose（资源释放）当前注册；没有优先级链，也没有按 agent 选择提供方的机制。
- **没有注册观察**——提供方注册或释放时 hub 不发出任何事件；消费者在调用时解析提供方。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无运行时不变式伴生入口：单槽注册表直接在操作点拒绝重复与缺失的提供方，因此不存在独立可观察、可能与之分歧的状态，伴生入口无从捕获。

</details>
