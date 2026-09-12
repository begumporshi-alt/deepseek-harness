---
description: "memory 组的地图：经由 ctx.memory seam、本地文件系统提供方与面向模型的工具实现的跨会话持久知识条目，面向浏览本组的用户与维护者。"
kind: "package-group"
---

# memory/ — 记忆能力系列

[English](README.md) | 中文

## 概述

memory 系列赋予 agent 超越任何单个会话的持久知识：关于用户的事实、反馈、项目约束与参考指引。`dsh-memory` 定义 `ctx.memory` seam，且其上仅注册一个提供方；`dsh-memory-local` 把条目存为项目下的 markdown 文件；`dsh-tool-memory` 暴露面向模型的工具并发布每会话一次的记忆索引。这些包都是可选的且位于宿主侧：默认 profile 不包含其中任何一个，因此除非组合加载了该系列，记忆保持关闭。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 角色 | ctx 键 |
|---|---|---|
| [`memory/`](memory/README.zh.md) | Service Definition：`ctx.memory` 的单槽提供方注册表与共享错误契约 | `ctx.memory` |
| [`memory-local/`](memory-local/README.zh.md) | 文件系统提供方：项目目录下每条条目一个 markdown 文件 | 注册在 `ctx.memory` 上 |
| [`tool-memory/`](tool-memory/README.zh.md) | Consumer：`memory_save`／`memory_search`／`memory_list`／`memory_forget` 工具外加会话开始的索引分节 | 注册在 `ctx.tools` 上 |

-----

<a id="related-documentation"></a>
## 相关文档

- [记忆 subsystem](../../docs/subsystems/memory.zh.md)——seam、提供方与消费者的权威契约。
- [启用持久记忆](../../docs/user/guide/memory.zh.md)——随附 overlay 的设置、配置与验证。
- [能力 seam](../../docs/architecture.zh.md)——本系列遵循的 Service Definition／Provider／Consumer 拆分。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
