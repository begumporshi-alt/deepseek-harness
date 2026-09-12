---
description: "面向模型的自动化消费者：基于 ctx.automation 的 automation_create、automation_list 与 automation_delete 工具，面向向 agent 暴露定时工作的组合。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-automation

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

`dsh-tool-automation` 在 `ctx.tools` 上注册 `automation_create`、`automation_list` 与 `automation_delete` 三个工具。模型描述一个调度——未来某一时刻、一个间隔或一个 cron 表达式——以及一个目标：全新会话（默认为调用方的工作目录，也可以显式指定）或要恢复的既有会话。错误以带 schema 的错误值呈现，让模型能够纠正自己的输入；被拒绝的创建会指明确切的字段。

<a id="use-this-package"></a>
## 使用本包

在 `dsh-automation` 之后加载 `dsh-tool-automation`；这些工具在插件生命周期内保持注册，并把每个操作委托给 `ctx.automation`。

### 工具表面

| 工具 | 参数 | 结果 |
|---|---|---|
| `automation_create` | `title`、`prompt`、`at` / `every_seconds` / `cron` 三选一（可附可选的 `time_zone`）、可选的 `cwd` 或 `session_id` | 存储的记录，包含触发器、目标与下次到期时刻 |
| `automation_list` | — | 每条存储记录及其最近一次运行结果 |
| `automation_delete` | `id` | 是否移除了一条记录 |

`at` 参数是 ISO 8601 时间戳；`every_seconds` 与 cron 的相邻两次触发必须至少间隔 300 秒。`session_id` 优先于 `cwd`，两者都省略时目标是进程工作目录中的全新会话。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

### 设计哲学

- **扁平的工具参数。** 三选一的触发器选择在工具层校验并以 `invalid_input` 报告，沿用 schedule 工具的表面。
- **这里没有调度逻辑。** 每条规则——密度下限、未来时刻、未知会话——都位于服务中；工具只把扁平参数翻译成服务的触发器与动作结构。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/tools.ts`](src/tools.ts) | 三个工具定义、触发器选择、视图投影与错误映射 |
| [`src/index.ts`](src/index.ts) | 针对 `ctx.automation` 注册这些工具的插件接线 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [自动化子系统](../../../docs/subsystems/automation.zh.md)——运行时及其消费者的权威契约。
- [自动化能力 Agent Note](../../../.agents/notes/implemented/feature/2026-09-12-automation-capability.zh.md)——设计、被否决的备选方案与验证契约。

-----

<a id="model-experience"></a>
## 模型体验

### 自动化工具

#### 模型看到什么

这些工具为模型的请求载荷增加三个工具 schema，而每次到期的自动化运行都会向目标会话追加一条带 `automation` provenance 的 `user/message`；模型看到它必须据以行动的提示词，外加一行来源说明。

#### Token 影响

加载期间三个固定的工具 schema，外加目标会话中每次运行一条用户消息。

#### KV Cache 影响

工具 schema 会扩展每次请求的前缀；每次运行的用户消息都追加在上一个轮次边界之后。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制描述该消费者当前的范围；它们是包约束，而不是任务积压。

- **没有模型路由参数**——这些工具创建自动化时不带显式模型选择；每次运行都在运行时遵循当前的默认模型选择。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

**Runtime invariant:** No companion is published. 这些工具是对 `ctx.automation` 的无状态投影，而该服务自身是每一条可观察自动化事实的唯一写入者。

</details>
