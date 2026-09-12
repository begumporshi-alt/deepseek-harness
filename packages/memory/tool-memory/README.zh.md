---
description: "面向模型的记忆消费者：基于 ctx.memory 的 memory_save/search/list/forget 工具，外加每会话一次的记忆索引分节，面向塑造模型所见内容的部署方与维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-memory

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

`dsh-tool-memory` 把 `ctx.memory` 变成模型可见的能力：在 `ctx.tools` 上注册四个工具（`memory_save`、`memory_search`、`memory_list`、`memory_forget`），并在每个会话的第一个 step 之前注入一个持久的记忆索引分节。工具返回带 schema 的错误值而不是抛出异常，因此模型可以纠正自己的输入；缺少提供方时，该分节降级为不注入，而工具继续把接线失败呈现出来。

<a id="use-this-package"></a>
## 使用本包

将 `dsh-tool-memory` 与 `dsh-memory` 以及一个提供方一起加载。

```yaml
- id: tool-memory
  name: '@deepseek-ai/dsh-tool-memory'
  config:
    indexLineMaxChars: 120
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `indexLineMaxChars` | `120` | 每条索引行显示的条目内容最大字符数。 |

无效值会让插件加载失败。

<a id="understand-the-implementation"></a>
## 理解实现
<details>
<summary>实现细节——点击展开</summary>

### 设计哲学

- **会话日志是去重权威。** 索引发布扫描持久历史，因此恢复与分叉不会重复发布，注入内容也能从日志复现。
- **错误即值。** 被拒绝的记录映射到 schema 化的错误词汇（`invalid_content`、`content_too_large`、`provider_unavailable`、`internal_error`），模型无需一次失败的工具往返即可自我修正。
- **提供方留在 seam 之后。** 消费者不导入任何提供方；它只捕获 `MemoryError` 代码。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`Config` 校验、工具注册、pre-step 监听器 |
| [`src/tools.ts`](src/tools.ts) | 四个工具、输出 schema 与错误值映射 |
| [`src/section.ts`](src/section.ts) | 索引渲染、会话日志去重与 pre-step 处理器 |

</details>


<a id="further-exploration"></a>
## 进一步探索

- [记忆子系统](../../../docs/subsystems/memory.zh.md)——本消费者渲染的 seam 契约。
- [启用持久记忆](../../../docs/user/guide/memory.zh.md)——设置与验证。

<a id="model-experience"></a>
## 模型体验

### 记忆工具

#### 模型看到什么

四个工具，其 schema 与结果都固定在生成的[工具目录](../../../docs/tool-catalog.zh.md)中：`memory_save` 返回已保存的条目及其 ISO 字符串时间戳视图；`memory_search` 与 `memory_list` 返回条目列表，最新的变更排在最前，受提供方上限约束；`memory_forget` 返回该 id 是否存在。被拒绝的操作返回某个带 schema 的错误值，而不是让调用失败。

#### Token 影响

工具注册期间，工具 schema 会进入每次请求。结果与错误值保留在历史中，直到压缩（compaction）发生。

#### KV Cache 影响

仅追加。工具集合不变时，schema 前缀保持稳定；重载时的任何替换由注册表负责。

### 会话开始的记忆索引

#### 模型看到什么

当存储至少持有一条条目且尚未发布过索引时，在会话的第一个 step 之前注入的一条持久 user 消息：

##### 本字段的逐字文本

```markdown
<system-reminder>
Persistent project memory is available. Facts remembered from earlier sessions:

- [user] {first line of one entry per line, truncated to indexLineMaxChars characters with an ellipsis}

Record facts worth carrying into future sessions with `memory_save`. Check `memory_search` or `memory_list` before asking the user for information that may already be remembered.
</system-reminder>
```

#### Token 影响

每会话一条有界消息，大小与条目数及每行上限成正比；保留在历史中，直到压缩（compaction）发生。

#### KV Cache 影响

仅追加；该消息位于可复用请求前缀之后，绝不会替换更早的内容。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>



- **每会话发布一次**——会话中途保存的条目只能通过工具结果看到；注入的索引在下一个会话、分叉或恢复时刷新。
- **没有语义搜索**——工具暴露的是提供方的子串搜索；排序与 embedding 属于提供方职责，目前尚无已交付的提供方支持。
- **分节静默降级**——没有提供方注册时，索引直接缺席；只有工具会告诉模型记忆不可用。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

**Runtime invariant:** No companion is published. The model-visible surfaces (tool results and the index section) are pinned by the Loader-composition test and the section unit tests, and index dedupe reads the same session log the loop records, so no second observation exists to diverge.

</details>
