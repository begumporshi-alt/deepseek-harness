# 记忆

[English](memory.md) | 中文

跨会话的持久知识条目：`ctx.memory` seam 存什么、谁拥有存储、模型看到什么。[记忆 capability seam Agent Note](../../.agents/notes/implemented/feature/2026-09-12-memory-capability-seam.zh.md) 拥有设计决策；本页记录来自 [`packages/memory/`](../../packages/memory/README.zh.md) 的契约。

## seam 本身

`ctx.memory` 持有且仅持有一个 `MemoryProvider`。hub 服务自身不做任何 IO；每个操作都委托给已注册的提供方，在没有提供方时抛出 seam 的 `provider-missing` 代码，而不是退化为空存储。

| 字段 | 类型 | 含义 |
|---|---|---|
| `id` | `MemoryId` | 由提供方分配、跨会话稳定的品牌化字符串。 |
| `kind` | `'user' \| 'feedback' \| 'project' \| 'reference'` | 用户是谁；纠正与已确认的做法；项目目标与约束；外部资源指引。kind 指导回忆的表述方式，不是权限边界。 |
| `content` | `string` | 记住的事实，是后续会话无需当前对话即可使用的自包含文字。 |
| `createdAt` / `updatedAt` | `number` | 条目创建与最近变更的 epoch 毫秒时间戳。 |

四个操作分别是 `record`（存一条新记忆）、`list`（按提供方顺序读取全部）、`search`（大小写不敏感的内容匹配）、`forget`（删除一条，返回该 id 是否存在）。提供方拥有身份分配、上限与持久性；被拒绝的操作不改变已存储的集合。

## 错误契约

`MemoryError.code` 由 hub 与所有提供方共享，消费者因此无需导入任何提供方代码。`duplicate-provider` 与 `provider-missing` 是 hub 抛出的接线错误；`invalid-content` 与 `content-too-large` 是提供方抛出的记录输入错误。全部受支持的提供方字段见生成的[配置目录](../config-catalog.zh.md#deepseek-aidsh-memory-local)。

## 模型看到什么

消费者 `dsh-tool-memory` 在 `ctx.tools` 上注册 `memory_save`、`memory_search`、`memory_list` 与 `memory_forget`，并在会话非空时于首个 step 之前注入一条持久的记忆索引 user 消息。索引去重读取会话日志本身，因此恢复与分叉不会重复发布。会话中途保存的记忆通过工具结果呈现；索引在下一个会话刷新。工具结果中的时间戳渲染为 ISO 8601 字符串；索引按条目渲染一行首行摘要，截断到配置的 `indexLineMaxChars`。

## 数据在哪里

交付的提供方 `dsh-memory-local` 在 `<projectRoot>/.dsh/memory/entries/` 下为每条记忆存储一个 markdown 文件，frontmatter 携带身份与时间戳。该目录是唯一事实来源：没有索引文件、缓存或数据库需要 reconcile。搜索是对内容的子串匹配；本家族不存在 embedding 或排序。

## 相关文档

- [packages/memory 组](../../packages/memory/README.zh.md)——包地图。
- [启用持久记忆](../user/guide/memory.zh.md)——面向用户的设置指南。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxmemory--memory"></a>

### `ctx.memory` — `Memory`

The memory service. Registered as `ctx.memory` (one instance per context). A provider registers under Memory.registerProvider; every read and write delegates to it. With no provider registered, every operation throws MemoryError `provider-missing` — misconfiguration never silently degrades to a no-op store.

```ts cordis-catalog
/**
 * Register the memory provider. Throws {@link MemoryError}
 * `duplicate-provider` when a provider is already registered. Returns a
 * disposer; disposed with the calling fiber.
 * @param provider - The provider implementation to register.
 * @returns the disposer that unregisters the provider.
 */
registerProvider(provider: MemoryProvider): () => void

/**
 * Store one new memory entry.
 * @param input - The kind and content to store.
 * @returns the stored entry with its provider-assigned identity.
 */
record(input: MemoryRecordInput): Promise<MemoryEntry>

/**
 * Read every stored memory entry.
 * @returns all entries in provider-determined order.
 */
list(): Promise<readonly MemoryEntry[]>

/**
 * Read the stored entries matching a query.
 * @param query - Case-insensitive text matched against entry content.
 * @returns the matching entries in provider-determined order.
 */
search(query: string): Promise<readonly MemoryEntry[]>

/**
 * Delete one memory entry.
 * @param id - The entry to delete.
 * @returns `true` when the entry existed and was deleted, `false` when the id is unknown.
 */
forget(id: MemoryId): Promise<boolean>
```

Source: [`packages/memory/memory/src/index.ts`](../../packages/memory/memory/src/index.ts)
<!-- END GENERATED cordis-surface -->
