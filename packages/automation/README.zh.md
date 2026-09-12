---
description: "automation 组的地图：到期即创建或恢复 Session 的持久应用级调度，面向浏览本组的用户与维护者。"
kind: "package-group"
---

# automation/ — 跨会话自动化系列

[English](README.md) | 中文

## 概述

automation 系列让 harness 在无人驱动的情况下运行计划任务。一个 automation 把一个触发器——未来某一时刻、固定间隔或指定时区的 cron 表达式——与一个目标配对：全新会话或需要恢复的既有会话。到期时，运行时把提示词作为带 automation 溯源的消息提交进目标会话，并记录该回合的结果。记录持久化到一个 JSON 存储文件，因此调度在重启后依然有效：未运行且已过期的一次性任务会在加载时补发，周期性触发器在停机后最多补跑一次并重新对齐。本组的服务包拥有调度与分发；工具包把管理能力暴露给模型。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 角色 | ctx 键 |
|---|---|---|
| [`automation/`](automation/README.zh.md) | automation 运行时：持久记录集、触发器数学、到期分发与 Session 创建/恢复执行 | `ctx.automation` |
| [`tool-automation/`](tool-automation/README.zh.md) | Consumer：`automation_create`／`automation_list`／`automation_delete` 工具 | 注册在 `ctx.tools` 上 |

-----

<a id="related-documentation"></a>
## 相关文档

- [自动化 subsystem](../../docs/subsystems/automation.zh.md)——运行时与其消费者的权威契约。
- [Automation 能力 Agent Note](../../.agents/notes/implemented/feature/2026-09-12-automation-capability.zh.md)——设计、被否决的替代方案与验证契约。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>面向维护者的工作上下文——点击展开</summary>

运行时是 webhook 模式的持久化版本：自有存储文件中的应用级记录取代了即发即忘的规则调用，且唯一的 Session 创建事务增加了恢复路径。两个包均不发布 invariant companion——运行时是所有可观察 automation 事实的唯一写入方。

</details>
