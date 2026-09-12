---
description: "自动化运行时 (ctx.automation)：到期时创建或恢复 Session 的应用级持久调度，面向为定时工作接线的部署方与插件作者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-automation

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

`dsh-automation` 拥有 `ctx.automation`：一组持久的定时自动化记录。每条自动化把一个触发器——未来某一时刻、固定间隔或具名时区中的 cron 表达式——与一个动作配对：创建全新的根 Session 或恢复既有 Session、提交提示词并等待被驱动的轮次。记录持久化到单个可挺过重启的 JSON 存储文件；加载时尚未运行的过期一次性任务会立即执行，重复触发器在停机后重新对齐，代价是最多一次补偿运行。

<a id="use-this-package"></a>
## 使用本包

在需要运行定时工作的任何长生命周期组合中加载 `dsh-automation`，并同时加载 `dsh-tool-automation`，让模型能够通过工具创建、列出和删除自动化。该运行时依赖 agent 注册表、默认模型选择、会话存储与一个会话持久化提供方；缺少其中任何一项的组合都会在加载时失败。

### 配置

| 字段 | 类型 | 默认值 | 含义 |
|---|---|---|---|
| `storePath` | `string` | `<dsh home>/automations/automations.json` | 持久存储文件的绝对路径。 |

### 触发器规则

| 种类 | 字段 | 调度规则 |
|---|---|---|
| `once` | `at` | 在未来某一时刻触发一次；运行前崩溃会在加载时再次触发。 |
| `every` | `intervalSeconds` | 与锚点对齐的固定速率；较长空档付出一次补偿运行，随后重新对齐。 |
| `cron` | `expression`, `timeZone?` | 在具名 IANA 时区中求值的五段或六段 cron 表达式。 |

所有重复触发器的相邻两次触发必须至少间隔 300 秒；创建时会拒绝更密集的调度。

### 交付契约

对一次性任务提供至少一次交付：进程停机期间到期的 `once` 自动化会在加载时执行一次。重复自动化直接推进越过错过的触发，不做集中补发。一次运行的结果在被驱动的轮次结束且会话日志刷盘之后才记录；轮次与记录写入之间发生的崩溃可能让一次运行重复执行。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

### 设计哲学

- **应用级作用域，Session 为目标。** 记录集与驱动器位于进程级别，而每次运行都落在由正常生命周期拥有的普通根 Session 中。
- **运行即事务。** 一次运行会创建或恢复其目标，携带 `automation` provenance 提交提示词，等待空闲，刷盘，从持久的 `turn/end` 推导结果，并 dispose（资源释放）它拥有的任何句柄。存活的目标 agent 会被原地复用，绝不被 dispose。
- **单一驱动器，杜绝惊群。** 到期记录在同一个 single-flight 唤醒遍中顺序运行；遍进行中到来的唤醒只会顺延为恰好再一次唤醒遍。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | `AutomationRuntime` 服务：记录集、定时器循环、公开的 create/list/delete、teardown |
| [`src/domain.ts`](src/domain.ts) | 纯触发器运算、校验、补偿推导与持久记录解码 |
| [`src/store.ts`](src/store.ts) | JSON 存储文件：原子写入、串行化保存、按版本门控的读取 |
| [`src/run.ts`](src/run.ts) | 单次运行：创建或恢复目标、提交、等待、汇总、dispose |
| [`src/types.ts`](src/types.ts) | 记录、触发器、动作与运行的词汇，包括品牌化的 `AutomationId` 与 `MessageSourceMap` provenance 种类 |
| [`src/brand.ts`](src/brand.ts) | 品牌化的 `AutomationId` |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [自动化子系统](../../../docs/subsystems/automation.zh.md)——运行时及其消费者的权威契约。
- [自动化能力 Agent Note](../../../.agents/notes/implemented/feature/2026-09-12-automation-capability.zh.md)——设计、被否决的备选方案与验证契约。

-----

<a id="model-experience"></a>
## 模型体验

间接生效：通过 `dsh-tool-automation`，它把自动化管理暴露为工具结果，而本服务不贡献任何提示词或 schema。

#### KV Cache 影响

无直接失效；请求前缀的任何变更由对应的消费者负责。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制描述运行时当前的范围；它们是包约束，而不是任务积压。

- **顺序运行**——到期自动化按唤醒顺序一次运行一条；长时间运行的会话会延迟其他到期自动化。
- **没有暂停与立即运行**——记录仅支持创建、列出与删除；暂停与立即手动运行延期实现。
- **存储写入为整文件**——每次变更都会重写完整记录集；存储规模由记录数界定，而非运行历史。
- **每个存储一个进程**——指向同一存储文件的并发进程之间没有跨进程租约；最后写入者胜出。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

**Runtime invariant:** No companion is published. 该运行时在相同的调用点上既是内存记录集也是存储文件的唯一写入者，因此不存在独立可观察、其分歧可被伴生入口捕获的状态。

</details>
