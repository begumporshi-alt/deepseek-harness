# Agent Note：MCP server 桥接器

Status: implemented

[English](2026-09-12-mcp-server-bridge.md) | 中文

## 问题

harness 中的 MCP 能力此前是单向的：`dsh-mcp-client` 挂载外部 MCP 服务器，让它们的工具到达模型，但没有任何东西把 harness 自身的工具暴露给外部 MCP 客户端。差距审计的构建顺序将其列为剩余项中价值最高的一项——它把每项 dsh 能力都变成其他 agent（Claude Code、Codex、任何 MCP host）可驱动的生态工具，也是"从其他产品使用 dsh 工具"这一问题的最干净答案。

## 决策

交付 `packages/mcp/mcp-server`——对外 MCP 桥接器——以及 `packages/bundle/mcp-app` 和 `mcp` profile 模板，沿用 ACP 应用的形态：

- 桥接器使用 SDK 的低层 `Server`，配以原始的 `ListToolsRequestSchema`/`CallToolRequestSchema` 处理器。高层 `McpServer` 以 zod 为先，不接受 harness 的无损 JSON 方言；低层 API 接受标准 JSON Schema 对象，桥接器通过把 dsh 方言（逐属性的 `required` 标记）递归投影为顶层 `required` 数组来生成它们（`dshSchemaToMcp`）。
- 每进程一个根 agent，在第一次 `tools/call` 时惰性创建。MCP 没有与会话轮次匹配的会话概念，被服务的面就是部署的根工具集；所有客户端共享一个 agent，调用经由与原生调用相同的 `ctx.tools.execute` 流水线——包括权限、沙箱与会话日志。
- `tools/call` 的失败是值（`isError` 内容）；只有接线失败（未知工具、已销毁的桥接器）才以协议错误呈现。客户端取消随请求的 abort 信号传递。
- stdout 归 MCP 所有；`mcp` profile 的启动提供方只在命令行解析之后发布就绪（help 不占用 stdio 即退出），照搬 `dsh-acp-app` 的结构，使 `dsh --profile mcp` 成为一条无选项的命令。

桥接器经普通组合挂载；默认 profile 不变，`dsh --profile acp`/`sdk` 不受影响。

## 验证约定

无密钥测试覆盖 schema 投影（标记、嵌套、oneOf 分支、既有数组、标量）、投影辅助函数，以及一次真实的 wire 组合：桥接器在真实的 loop 栈上启动（测试依赖、JSONL 持久化、token 计量、agent loop、mock 适配器），挂载记忆家族的工具，经 `InMemoryTransport` 连接的 MCP `Client` 执行 `tools/list`（断言标准 schema 输入）、`tools/call` 将一条持久条目写入磁盘并往返、未知工具以协议错误拒绝、销毁时关闭传输。逐文件覆盖率 100%。远程 CI 不访问任何外部服务。

## 备选方案

**通过 ACP 桥接器提供工具。** 否决：ACP 是面向会话的 agent 协议，不是工具服务器协议；MCP 客户端无法使用它，且工具面语义（schema 方言、错误值）不同。

**高层 `McpServer` API。** v1 否决：其以 zod 为先的注册无法在不做反向有损转换的情况下表达 harness 的 JSON-schema 方言；低层 `Server` 直接接受投影后的 schema。

**每客户端一个 agent。** 暂缓：MCP `initialize` 不携带任何 workspace 或会话身份，按客户端隔离会发明一个没有协议信号可作键的映射；共享一个根 agent 与单用途工具服务器的做法一致。

**HTTP 传输。** 暂缓：stdio 覆盖了当前所有 MCP host 使用的本地进程信任模型；远程服务需要先有认证方案。

## 后果

任何 MCP host 都可以驱动部署的工具面，包括记忆工具等第一方能力。需要审批的操作失败关闭（stdio 上没有交互面）——服务敏感工具的部署必须配置机器策略。共享 agent 意味着每个服务进程一份会话日志。未来的每客户端或 HTTP 变体只需替换传输与 agent 创建策略即可组合，两者都局部于桥接器。
