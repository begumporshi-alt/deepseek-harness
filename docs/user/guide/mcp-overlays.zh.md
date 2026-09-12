# 连接精选 MCP 工具服务器

[English](mcp-overlays.md) | 中文

这些**默认关闭的参考配置**通过 [`@deepseek-ai/dsh-mcp-client`](../../../packages/mcp/mcp-client/README.zh.md) 将开箱即用的 MCP 工具服务器连接到 DSH。用 `--patch` 传入其中一份 overlay，或按[记忆 MCP 指南](./mcp-memory.zh.md)的说明把它的 `insert` patch 合并到用户 patch 层。默认 profile 不包含这里的任何内容；不传 `--patch` 就会让所有服务器保持关闭。

这些第三方配置仅作为互操作参考；收录不代表 DeepSeek 的认可、推荐、合作关系或持续支持承诺。

DSH 以 `mcp__<serverName>__<tool>` 的形式公开每台服务器的工具；传输、命名、重连与环境变量清洗契约由 [MCP 客户端 README](../../../packages/mcp/mcp-client/README.zh.md) 负责。DSH 从不安装服务器软件包，也不下载浏览器——下面的前置条件都需要显式完成。

## 选择一个服务器

| 服务器 | 已测试版本 | 传输方式 | 新增能力 | 上游前置条件 |
|---|---:|---|---|---|
| [Playwright MCP](https://github.com/microsoft/playwright-mcp) | `@playwright/mcp@0.0.80` | stdio | 以 `mcp__playwright__*` 工具进行浏览器自动化 | Node 22.18+，执行 `npm install --global @playwright/mcp@0.0.80`，并有用于工具调用的 Chrome 系浏览器 |
| [Context7](https://context7.com) | 托管服务，`serverInfo.version` 4.1.0，2026-09-12 验证 | streamable-http | 以 `mcp__context7__*` 工具查询库与 API 文档 | 无；匿名访问有速率限制 |
| 记忆系统 | — | — | 跨会话持久记忆 | [记忆 MCP 指南](./mcp-memory.zh.md) |

## 浏览器自动化（Playwright MCP）

```sh
npm install --global @playwright/mcp@0.0.80
dsh web --patch "$PWD/apps/cli/config/examples/mcp-overlays/playwright.cordis.yml"
```

模型会得到该服务器完整的 `browser_*` 工具面——已测试版本共 24 个工具，包括导航、快照、点击、填写、截图与标签页。工具调用驱动的是本机真实浏览器：打开的页面、提交的表单与下载都是真实操作。当会话可能触达你在意的账户时，请留意当前生效的审批策略。

## 文档查询（Context7）

```sh
dsh web --patch "$PWD/apps/cli/config/examples/mcp-overlays/context7.cordis.yml"
```

无需本地安装：DSH 连接托管 Streamable HTTP 端点，该端点必须已经可达。匿名访问有速率限制。若需认证访问，请复制该 overlay 并添加从环境变量读取密钥的 `headers` 配置：

```yaml
        headers:
          X-Context7-API-Key: !!js process.env.CONTEXT7_API_KEY
```

并在启动 DSH 前设置 `CONTEXT7_API_KEY`。该服务器还提供提示词与资源；与本客户端身后的所有服务器一样，只有工具会被桥接（[已知限制](../../../packages/mcp/mcp-client/README.zh.md#known-limitations-and-deferred-work)）。

## 验证

初始发现是异步的——等该服务器的 `mcp__...` 工具出现后，每台服务器用一条提示词验证：

1. Playwright：`打开 https://example.com 并截取页面快照。` 模型应调用某个 `mcp__playwright__*` 工具并描述该页面。
2. Context7：`用 context7 查询 <库名> 的最新上手文档。` 模型应先调用 `mcp__context7__resolve-library-id`，再调用 `mcp__context7__query-docs`，且答案反映当前文档。

要接入其他 MCP 工具服务器，请复制[记忆 MCP 指南](./mcp-memory.zh.md)中的通用配置项。
