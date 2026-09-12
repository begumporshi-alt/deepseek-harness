# 启用自动化

[English](automations.md) | 中文

这些**默认关闭的 overlay 配置**赋予 DSH 跨重启的调度能力：模型可以创建按定时器运行提示词的 automation——在全新会话中，或通过恢复既有会话。自动化使用第一方包——没有外部调度器——并把所有记录存放在 dsh 主目录下的一个 JSON 文件里。

## 启用一个

```sh
dsh web --patch "$PWD/apps/cli/config/examples/automations/cordis.yml"
```

该 overlay 一次性加载 automation 运行时与面向模型的工具。任何默认 profile 都不启用它；不传 `--patch` 即保持关闭。要跨运行保持选择，按 [MCP overlays 指南](./mcp-overlays.zh.md)的说明把 overlay 的 `insert` patch 合并进用户 patch 层——分层方法相同。

由于到期运行在 profile 的进程内执行，automation 调度只在该进程运行期间推进；重启会补发未运行的一次性任务并重新对齐周期性触发器。

## 模型获得什么

启用后，模型看到三个工具——`automation_create`、`automation_list` 与 `automation_delete`。每种能力用一个提示词验证：

1. 询问：`Every five minutes, summarize nothing but reply with the word tick.` 模型应调用 `automation_create` 并传入 `every_seconds: 300`（最小间隔）。
2. 等待一个间隔后询问：`List the automations.` 模型应调用 `automation_list` 并报告最近的运行结果。
3. 询问：`Delete the tick automation.` 模型应调用 `automation_delete`。

cron 表达式（`30 9 * * mon-fri`，可选 IANA `time_zone`）与一次性 ISO 8601 时刻是另外两种触发器。`resume-session` 目标让一个会话按计划持续推进；默认目标在工作目录中启动全新会话。

## 数据存放位置

存储是一个 JSON 文件——默认 `~/.dsh/automations/automations.json`——保存每条记录的触发器、目标与最近运行结果。每次运行创建或恢复的普通会话日志落在常规 sessions 目录中，因此运行记录可以用任何会话工具检视。存储路径可通过 overlay 的 `config` 块配置——每个接受的字段见[配置目录](../../config-catalog.zh.md#deepseek-aidsh-automation)。

## 已知边界

周期性触发器的两次触发必须至少间隔 300 秒。运行串行执行，因此长时间运行的会话会延迟其他到期的 automation。调度只在 profile 的进程运行期间推进；没有任何机制唤醒已停止的宿主。要移除该能力，停止传递 overlay 即可。
