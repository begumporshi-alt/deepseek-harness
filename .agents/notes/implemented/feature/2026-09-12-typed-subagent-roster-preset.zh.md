# Agent Note: 类型化子代理名册 preset

状态：已实现

[English](2026-09-12-typed-subagent-roster-preset.md) | 中文

## 问题

ZCode 一类的 agent CLI 随附类型化的子代理名册：具名的委派目标（`bug-hunter`、`codebase-mapper`、`code-reviewer`），其角色提示词与工具授权固定在配置中，父代理只需指明任务，无需每次委派时重新描述角色。DSH 拥有全部机制——`agent-presets` 名册、`tool-subagent` 插件的逐实例 `toolName`／`persona`／`toolFilter` 配置、声明了这些能力的 spawn 提供方——但会话 preset 内只随附了通用的委派工具（`subagent`、`subagent_fork`）。差距在于待编写的组合内容，而非产品代码。

## 决策

交付第五个 preset `research`，端到端地运用类型化名册形态：

- **只读优先的会话表面。** 该 preset 组合出分析型 Agent：文件阅读与检索（`tool-fs`、`tool-fs-search`）、网页搜索与抓取（`tool-web`）、压缩与委派——没有 shell、workflow 与 goal。
- **类型化委派行。** 委派组中的两个 `tool-subagent` 实例在配置中固定子代理的角色：`researcher`（代码库与主题梳理，白名单 `read`／`read_image`／`grep`／`glob`／`web_search`／`web_fetch`）与 `reviewer`（变更与论断评审，白名单 `read`／`read_image`／`grep`／`glob`）。两者都经 spawn 提供方以 continuable 方式运行，并携带约束其为只读汇报的 persona。
- **默认表面不变。** 该 preset 以可选取的 `research` id（`order: 4`）加入随附根；不改动任何既有 preset、profile 或默认值，因此录制会话快照与随附 token 成本不受影响。

会话表面自身仍在目录中列出 `write`／`edit`（它们随 `tool-fs` 的工具套件一起到来）；只读约束在关键处成立——类型化子代理的白名单在子代理提示词组装之前就被运行时剥除，其 persona 再一次重申该约束。

## 验证契约

shipped-root 套件列出五个 preset 的名册、报告新 preset 健康（无 malformed 原因），并通过共享 schema 解析其条目列表。一个聚焦测试固定类型化名册的形态：两行都存在、都使用 spawn 提供方且 persona 非空、白名单中的每个名字都是阅读或检索工具、且 `write`、`edit` 与 `bash` 不在其中。web-fetch 循环现在把 `research` 与其他带工具的 Web preset 一并覆盖。

## 备选方案

**把类型化行加进 `standard`。** 否决：每个 standard 会话的模型可见 schema 都会多出两个工具，改变默认 token 表面，并迫使为本质上是组合选择而非产品默认的内容重新录制快照。

**单独的 `tool-subagent` 仅配置 overlay。** 否决：常驻的 tool-subagent 行属于 preset 的 agent 平面，overlay patch 无法插入 preset 的私有组合；名册才是被认可的编写表面。

**会话层面也强制只读。** 暂缓：`tool-fs` 无条件注册其变更工具；只读开关将是对核心工具包的产品级改动。类型化子代理今天已经在构造上只读。

## 后果

用户为分析会话选取 `research`，即获得可按名字信任的委派名册；想要自己类型化角色的部署复制该 preset 并编辑这些行。未来的类型化 preset（planner、tester）遵循同样的行形态，无需产品改动。该 preset 的会话表面保持 `write`／`edit` 可见——此处与 preset 文件中均有记录——直到 `tool-fs` 提供只读开关。
