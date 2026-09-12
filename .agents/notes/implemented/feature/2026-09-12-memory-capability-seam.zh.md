# Agent Note：记忆 capability seam

Status: implemented

[English](2026-09-12-memory-capability-seam.md) | 中文

## 问题

ZCode 一类的 agent CLI 自带跨会话持久记忆：关于用户、反馈与项目的类型化事实，会话开始时载入上下文，并可由模型写入。DSH 此前没有任何第一方记忆——只有会话日志搜索工具、第三方记忆 MCP 服务器和"工作区即记忆"的约定。差距审计的构建顺序将此列为价值最高的第一方缺口。若把第三方 MCP 记忆配置项当作长期答案，核心的连续性就会一直依赖一个带有自身存储模型的可选外部服务。

## 决策

交付 `packages/memory/` capability family，覆盖 seam 的三个角色：

- `@deepseek-ai/dsh-memory`——Service Definition：`ctx.memory` 持有且仅持有一个 `MemoryProvider`，并委托 `record` / `list` / `search` / `forget`。条目为 `{ id: MemoryId（品牌化）, kind: 'user' | 'feedback' | 'project' | 'reference', content, createdAt, updatedAt }`。hub 不做 IO；没有提供方时每个操作抛出 `provider-missing`，重复注册抛出 `duplicate-provider`。
- `@deepseek-ai/dsh-memory-local`——交付的提供方：在 `<projectRoot>/.dsh/memory/entries/` 下每条记忆一个 markdown 文件，frontmatter 含 `id`、`kind`、`createdAt`、`updatedAt`，原子写入且文件权限仅属主可读，可配置上限（`maxEntryChars` 4000、`maxListEntries` 200），子串搜索，损坏的条目文件读取时大声失败。
- `@deepseek-ai/dsh-tool-memory`——消费者：`memory_save` / `memory_search` / `memory_list` / `memory_forget` 工具，外加经 `agent/pre-step` 瀑布注入的每次会话一条的记忆索引 section，以持久会话日志（`memory-index` 消息 source）去重。

记录输入的错误代码（`invalid-content`、`content-too-large`）放在 seam 上而非提供方上，因此消费者无需导入提供方代码即可映射失败。本家族以默认关闭的 overlay 交付（`apps/cli/config/examples/memory/cordis.yml`）；默认 profile 不变，录制的会话快照与交付的 token 成本不受影响。跨会话数据刻意不进入 `SessionEventMap`——记忆不是模型可见的会话历史，且"模型可见 ⟺ 已记录"不变式依然成立，因为模型看到的一切（工具结果、索引消息）都照常记录。

## 验证约定

无密钥测试覆盖服务（接线失败大声报错、委托、释放）、存储（往返、上限、排序、损坏条目大声失败、目录仅解析一次）、section（基于日志的去重、截断、reject 透传、缺提供方时的退化），以及通过 Loader 启动 `cordis.yml` 的真实 Loader 组合，对临时存储执行记忆工具，包括缺提供方的组合。远程 CI 不访问任何外部服务；存储是纯本地文件系统。

## 备选方案

**把记忆建在 storage-domain KV seam 之上。** v1 否决：记忆条目是人类可读、可编辑的文档，一文件一条目的存储保留这一性质；domain 层会引入当前消费者都不需要的 schema 与通知机制。

**让 agent 直接维护 MEMORY.md 索引文件。** 否决：手写索引是同一批事实的第二种表示，会漂移；注入的索引在读取时从条目渲染，无需 reconcile。

**把索引做成会话事件。** 否决：索引派生自跨会话数据，不是会话历史；把它发布为会话事件会分叉真相，且没有任何消费者受益于回放复杂化。

**语义／embedding 召回。** 暂缓：子串搜索满足当前需求；拥有 embedding 的提供方可经同一 seam 接入。

## 后果

启用组合中的每个会话都以已记住的事实开始，并能扩展它们；移除 overlay 即移除能力，不涉及任何产品代码。存储假定每个项目目录一个 harness 进程——并发的多进程写入没有加锁。未来的提供方（远程、带 embedding）只需在 `ctx.memory` 上注册，无需触碰消费者。
