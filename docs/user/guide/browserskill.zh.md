# 使用 BrowserSkill 进行浏览器自动化

[English](browserskill.md) | 中文

`web` profile 随附 BrowserSkill 集成：模型可以通过第一方的 `browser_*` 工具驱动**真实的、已登录的浏览器**——无需 MCP 服务器或 shell 中转。BrowserSkill（腾讯）运行本地守护进程与浏览器扩展；agent 在专用的 Agent Window 中工作，绝不会抢占你自己的窗口或标签页。

## 模型获得什么

每个 web 会话都带有六个工具——`browser_session`（启动/停止自动化会话）、`browser_page`（导航、后退、前进、刷新、等待）、`browser_inspect`（快照、html、截图、控制台、网络）、`browser_interact`（点击、悬停、填充、选择、按键）、`browser_tabs`（列出、创建、选择、关闭、借用、归还）与 `browser_assist`（调整大小、模拟、暂停等待人工协助）——外加通过 `skill` 工具提供的 `browser-skill` skill，其中记录了有效的使用模式。

## 前置条件

这些工具存在于每个 web 会话中，但在安装 BrowserSkill 技术栈之前，每次调用都会失败并给出安装指引：

1. 安装 `bsk` CLI（见 [BrowserSkill 仓库](https://github.com/Tencent/BrowserSkill)）。
2. 启动守护进程（`bsk` 首次使用时会自动启动）。
3. 安装 BrowserSkill 浏览器扩展，并确认有一个扩展已连接。

`browser_session` 工具的 `action=start` 会打开 Agent Window；`action=list` 会在出问题时报告连接健康状态。

## 安全边界

agent 驱动的是你控制的浏览器配置：它可以访问你已登录的每个站点，且都在它打开的窗口内。请像对待坐在你键盘前的同事一样对待它的请求——`browser_assist` 的暂停动作正是为应该由人执行的步骤（凭据、支付、不可逆操作）准备的。截图与快照像任何工具结果一样进入会话日志，因此 agent 在会话期间观察到的一切都会随会话保留。

## 移除

BrowserSkill 组合包是普通的 profile 层。从 `$DSH_HOME/profiles/web/package.json` 的 `bundles` 中移除 `@wxg-prc-cpg/browser-skill-dsh-plugin` 并重启 `dsh web` 即可；被你编辑过 bundle 列表的 profile 从此属于你——后续的随附模板变更不会再改写它。
