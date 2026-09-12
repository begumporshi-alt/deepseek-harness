# Agent Note: Automation 能力

状态：已实现

[English](2026-09-12-automation-capability.md) | 中文

## 问题

ZCode 一类的 agent CLI 具备跨会话自动化：模型调度未来或周期性工作（cron 表达式、一次性时刻），这些工作跨重启存活并在全新或恢复的会话中运行提示词。DSH 有 `dsh-schedule`——以会话内消息投递的会话本地提醒——和 `dsh-jobs`——进程内的活跃工作注册表——但没有持久的、应用级的、能按定时器创建或恢复 Session 的能力。差距审计的构建顺序将其列为第 4 项；webhook 系列拥有正确的 Session 创建形态，但有意做成即发即忘，因此缺失的是持久存储、触发器词汇表与恢复路径。

## 决策

交付一个具备该能力各角色的 `packages/automation/` 系列：

- `@deepseek-ai/dsh-automation`——Service Definition 与运行时：`ctx.automation` 在一个 JSON 存储文件中持有持久记录集（经串行化保存链的原子整文件写入、单调格式版本）与一个基于分段定时器的单次飞行到期驱动器。触发器为 `once`（未来时刻）、`every`（锚点对齐的固定频率）与 `cron`（在指定 IANA 时区求值的五段或六段表达式，由维护中的 `croner` 依赖求值——仓库内此前没有任何 cron 能力）。动作 为 `new-session`（在某目录创建根 Session）与 `resume-session`（就地复用活跃目标，或从持久化根恢复冷目标）。每个周期性触发器的两次触发必须至少间隔 300 秒，与 schedule 系列的下限一致。
- `@deepseek-ai/dsh-tool-automation`——Consumer：`automation_create`／`automation_list`／`automation_delete` 工具，接受扁平触发器参数（ISO 8601 的 `at`、`every_seconds`、`cron` + `time_zone`）与可选目标（`session_id` 优先于 `cwd`，默认为工作目录中的全新会话）。

一次运行在运行开始时解析模型路由（当前默认模型选择，或记录的显式路由），创建或恢复目标，以新的 `MessageSourceMap` `automation` 类型提交提示词，等待空闲，落盘，从持久的 `turn/end` 原因推导结果，并释放它拥有的任何句柄——就地复用的活跃目标绝不释放。运行在 `ctx.agents.withoutInitiator` 内按唤醒顺序串行执行。投递对一次性任务至少一次（未运行的过期 `at` 在加载时补发），对周期性触发器锚点推进（长期停机最多补跑一次）。该系列以默认关闭的 overlay 交付（`apps/cli/config/examples/automations/cordis.yml`）；不改动任何默认 profile，因此录制会话快照不受影响。

## 验证契约

无密钥套件覆盖：domain（触发器校验，含 cron 密度与不可能的调度、下个到期推导、补发、每个字段的持久化解码）、store（往返、原子写入、串行化保存、格式拒绝、非 ENOENT 重抛）、基于桩上下文的运行执行器（结果推导、失败遏制、中止重抛、清理告警）、基于真实 loop 栈的运行时（带溯源的到期分发、失败回合、活跃复用、冷恢复、重启补发、删除、重新布防排序、持久化失败遏制、关闭）以及工具（触发器选择、目标优先级、视图投影、错误映射）。一处带理由的 v8 pragma 覆盖 croner 的非 Error 拒绝回退——该库无法产生它。

## 备选方案

**把 `dsh-schedule` 扩展到应用级。** 否决：其持久化基底是会话事件日志，投递模型硬绑定到单个活跃会话（`session-local` 投递模式）；应用级存储与宿主级驱动器会替换掉几乎全部实现，同时让包名保持误导。

**用持久化前端复用 webhook 运行时。** 否决：webhook 的即发即忘契约（无队列、无重放、无重试）是服务规则作者的已记录决策；automation 恰恰需要该契约排除的状态性，合并会削弱 webhook 的关闭保证。

**像 schedule 变更那样把 automation 事件溯源进会话日志。** 否决：automation 不是会话数据——它比它目标的任何会话都活得久，且必须在任何会话存在之前加载。自有的存储文件让记录集无需会话上下文即可读写。

**按客户端的 agent 或并发运行。** v1 否决：单一串行驱动器让到期处理可预测并避免踩踏；代价（长运行延迟其他到期 automation）作为已知限制记录。

## 后果

模型现在可以调度比对话存活更久的工作，目标既可以是全新会话，也可以是它被指示继续的特定会话；移除 overlay 即以零产品代码介入移除该能力。存储是每个配置路径一个 JSON 文件——指向同一文件的并发进程没有跨进程租约。cron 解析是新的直接运行时依赖（`croner`，MIT，零依赖），已记入第三方声明。未来的触发器类型（日历规则、webhook 作为触发器）与动作通过同一记录词汇表接入，无需改动驱动器。
