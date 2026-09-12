---
description: "ctx.memory 的本地文件系统记忆提供方：项目目录下带可配置上限的持久 markdown 条目，面向选择记忆存储的部署方与扩展它的维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-memory-local

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

`dsh-memory-local` 在 `ctx.memory` 上注册本地文件系统提供方。每条条目都是存储目录下的一个 markdown 文件，带有最小的 frontmatter 头（`id`、`kind`、`createdAt`、`updatedAt`），正文即被记住的事实。条目目录是唯一事实来源；写入以仅所有者可访问的文件权限原子完成；读取按每次调用发出，因此 harness 停止期间被编辑过的条目在下一次使用时即可见。

<a id="use-this-package"></a>
## 使用本包

将 `dsh-memory-local` 与 `dsh-memory` 以及一个消费者（例如 `dsh-tool-memory`）一起加载。

```yaml
- id: memory
  name: '@deepseek-ai/dsh-memory'

- id: memory-local
  name: '@deepseek-ai/dsh-memory-local'
  config:
    maxEntryChars: 4000
    maxListEntries: 200
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `dir` | `<projectRoot>/.dsh/memory` | 存储目录；项目根目录是工作目录之上最近的包含 `.git` 的祖先目录。 |
| `maxEntryChars` | `4000` | 单条条目内容可容纳的最大字符数。 |
| `maxListEntries` | `200` | `list` 与 `search` 返回的最大条目数，最新的变更排在最前。 |

无效的上限会让插件加载失败。记录空内容或超大内容会以 seam 的 `invalid-content`／`content-too-large` 代码拒绝，且已存储的集合保持不变。

<a id="understand-the-implementation"></a>
## 理解实现
<details>
<summary>实现细节——点击展开</summary>

### 设计哲学

- **文件即数据库。** 每条记忆一个 markdown 文件，让存储可检视、可 diff、可用普通工具编辑；无需维护第二份表示。
- **上限即配置。** 条目大小与结果上限是经过校验的 `Config` 字段，而非硬编码的可调值。
- **拒绝即无副作用。** 写入失败或被拒绝的记录不会影响既有条目。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`Config` 校验、项目根目录解析、提供方注册 |
| [`src/store.ts`](src/store.ts) | `LocalMemoryStore`：条目文件、id 分配、上限，以及损坏条目读取时的响亮失败 |

</details>


<a id="further-exploration"></a>
## 进一步探索

- [记忆子系统](../../../docs/subsystems/memory.zh.md)——本提供方实现的 seam 契约。
- [启用持久记忆](../../../docs/user/guide/memory.zh.md)——设置与验证。

-----

<a id="model-experience"></a>
## 模型体验

无，因为提供方把条目存储在任何模型请求之外，不贡献任何提示词、工具 schema 或分节。

#### KV Cache 影响

没有任何模型请求携带提供方状态；失效由读取它的消费者负责。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>



- **仅支持子串搜索**——`search` 是对条目内容的大小写不敏感子串匹配；没有 embedding、排序或语义召回。
- **单进程存储**——来自多个 harness 进程对同一目录的并发写入没有加锁；存储假定每个项目目录只有一个活跃 harness。
- **条目损坏会让读取失败**——frontmatter 损坏的条目文件会让整个 `list`／`search` 读取响亮失败并指名该文件，而不是被跳过。
- **条目只追加不更新**——没有 update 操作；修改一条事实意味着忘记该条目并记录一条新条目。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

**Runtime invariant:** No companion is published. The entries directory is the only representation of the store, so there is no second observation of the same data that could diverge from it.

</details>
