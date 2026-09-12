# 自动化

[English](automation.md) | 中文

到期即创建或恢复 Session 的持久应用级调度：`ctx.automation` 存储什么、运行如何执行、模型看到什么。[Automation 能力 Agent Note](../../.agents/notes/implemented/feature/2026-09-12-automation-capability.zh.md) 拥有设计决策；本页记录来自 [`packages/automation/`](../../packages/automation/README.zh.md) 的契约。

## 运行时

`ctx.automation` 持有一个持久记录集与一个到期驱动器。一条记录把触发器与动作配对；最早的下一个到期时刻到来时，驱动器执行一次运行并记录其结果。运行时是应用级的：记录与驱动器位于进程层，而每次运行都落在由常规生命周期拥有的普通根 Session 中。

| 触发器类型 | 字段 | 调度规则 |
|---|---|---|
| `once` | `at` | 在一个未来时刻触发一次；运行前崩溃会在加载时补发。 |
| `every` | `intervalSeconds` | 锚点对齐的固定频率；长期停机最多补跑一次，然后重新对齐。 |
| `cron` | `expression`、`timeZone?` | 在指定 IANA 时区求值的五段或六段 cron 表达式。 |

| 动作类型 | 字段 | 运行行为 |
|---|---|---|
| `new-session` | `cwd` | 在该目录创建全新根 Session，提交提示词，并在运行后释放句柄。 |
| `resume-session` | `sessionId` | 就地复用活跃目标；冷目标从持久化根恢复，并在运行后释放句柄。 |

每个周期性触发器的两次触发必须至少间隔 300 秒；创建时拒绝更密的调度。`resume-session` 动作必须命名持久化根中存在的 Session——创建时即刻报错，而不是留到运行时。

## 投递契约

一次性任务至少投递一次：进程停机期间到期的 `once` automation 会在加载时补发一次。周期性 automation 越过错过的触发而不补发一批。运行结果在所驱动回合结束且会话日志落盘之后记录；回合与记录写入之间崩溃可能重复一次运行。运行按唤醒顺序串行执行——长时间运行的会话会延迟其他到期的 automation。

## 模型看到什么

Consumer `dsh-tool-automation` 在 `ctx.tools` 上注册 `automation_create`、`automation_list` 与 `automation_delete`。创建接受一个触发器（ISO 8601 时间戳 `at`、`every_seconds`、或带可选 `time_zone` 的 `cron`）与一个可选目标（`session_id` 优先于 `cwd`；两者都省略时以进程工作目录为目标的全新会话）。每次到期运行向目标会话追加一条带 `automation` 溯源的用户消息——automation 的身份与一行来源说明——因此模型看到的正是它需要处理的提示词。错误以带 schema 的错误值呈现并指明被拒绝的字段。

## 数据存放位置

存储是一个 JSON 文件——默认为 `<dsh home>/automations/automations.json`，或配置的 `storePath`——以单调的格式版本保存完整记录集。每次变更通过串行化的保存链原子地重写整个文件（临时文件加重命名）；读取方拒绝其他格式版本。除每条记录最近一次已结算的运行外，没有运行历史。

## 相关文档

- [packages/automation 组](../../packages/automation/README.zh.md)——包地图。
- [启用自动化](../user/guide/automations.zh.md)——面向用户的设置指南。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxautomation--automationruntime"></a>

### `ctx.automation` — `AutomationRuntime`

The automation runtime: a durable record set, a single-flight due driver over segmented timers, and the public create/list/delete surface. Every mutation persists the complete state before the next due instant is armed.

```ts cordis-catalog
/**
 * Create one automation.
 * @param input - validated creation input; a `resume-session` action must
 * name a persisted Session.
 * @returns the stored record.
 * @throws {@link AutomationInputError} for invalid input.
 */
async create(input: AutomationCreateInput): Promise<AutomationRecord>

/**
 * List every stored record.
 * @returns the records in creation order.
 */
async list(): Promise<readonly AutomationRecord[]>

/**
 * Delete one stored record.
 * @param id - the automation to remove.
 * @returns whether a record was removed; `false` for an unknown id.
 */
async delete(id: AutomationId): Promise<boolean>
```

Source: [`packages/automation/automation/src/index.ts`](../../packages/automation/automation/src/index.ts)
<!-- END GENERATED cordis-surface -->
