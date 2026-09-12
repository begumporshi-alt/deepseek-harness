# Agent Note：精选 MCP 工具服务器 overlay 示例

Status: implemented

[English](2026-09-12-mcp-server-overlay-examples.md) | 中文

## 问题

ZCode 一类的 agent CLI 内置浏览器自动化与最新文档查询能力；DSH 此前两者皆无。第三方记忆 MCP 示例（[来源笔记](../../archived/feature/2026-07-31-third-party-memory-mcp-examples.md)）确立了模式——通过通用 MCP 客户端提供可复制的默认关闭 overlay——但只覆盖记忆服务器，且所有已交付示例都使用 stdio，Streamable HTTP 缺少经过验证的参考。此时自建第一方浏览器或文档能力，会重蹈该笔记否决的错误：把本可由通用 MCP 边界表达的供应商 API、生命周期与语义拉进 DSH。

## 决策

交付第二个示例族 `apps/cli/config/examples/mcp-overlays`，包含两条基于 `@deepseek-ai/dsh-mcp-client` 的默认关闭配置项，以及一份负责安装与验证的目录指南：[连接精选 MCP 工具服务器](../../../../docs/user/guide/mcp-overlays.zh.md)。

- `playwright.cordis.yml`——Microsoft Playwright MCP（`@playwright/mcp@0.0.80`，可执行文件 `playwright-mcp`）的 stdio 配置项，向模型提供该服务器的 24 个 `browser_*` 工具，作用于本机的 Chrome 系浏览器。
- `context7.cordis.yml`——首份交付的 Streamable HTTP 示例：`mcp.context7.com/mcp` 上的托管 Context7 文档服务器，其 `resolve-library-id` 与 `query-docs` 工具带来最新库文档。

边界沿用记忆族并以相同方式表述：DSH 解析选中的 overlay、启动或连接传输、发现工具并以 `mcp__<serverName>__<tool>` 公开；用户安装固定版本的可执行文件，并自管账户、存储与监管。第三方收录仍仅为互操作参考，不构成认可。不使用 `npx` 的固定版本规则同样适用，原因与彼处探测相同：DSH 启动服务器进程，不是提供方的包管理器。记忆族保留自己的指南与配置项；本指南链接而不复述。产品代码、默认组合与 profile 均未改动。

## 验证约定

无密钥门禁解析两份 overlay 文件，并强制通用桥接与密钥边界（`verify-cordis-config`）。2026-09-12 在无 API key 情况下人工采集的连接级证据：`playwright-mcp@0.0.80` 经 stdio 应答 `initialize`（serverInfo Playwright 1.63.0-alpha-2026-08-31）并列出 24 个工具；Context7 端点经 Streamable HTTP 匿名应答 `initialize` 与 `tools/list`（serverInfo 4.1.0；工具 `resolve-library-id`、`query-docs`）。模型可见的端到端验证需要 API key，保留为指南中的验证步骤，与记忆指南的人工标准一致。

## 备选方案

**现在就建第一方浏览器 seam。** 暂缓：MCP 路线无需新增依赖，且先验证需求；只有当 MCP 路线不敷使用时才重新评估 `dsh-browser` seam。

**首批收录更多服务器。** 维持两台，保证两个固定版本都能诚实验证；目录按记忆族的方式逐行增长。

**在 web profile 中默认启用浏览器。** 否决：常驻浏览器进程及其 token 成本属于自愿选择；overlay 让移除简化为不传 `--patch`。

## 后果

用户以零产品代码获得浏览器自动化与文档查询，并自行接受各上游的信任、数据策略与 token 成本。精选固定版本会随上游漂移，需像记忆固定版本一样重新验证。未来示例族应链接本指南与客户端 README，而不是复述启用机制或边界。
