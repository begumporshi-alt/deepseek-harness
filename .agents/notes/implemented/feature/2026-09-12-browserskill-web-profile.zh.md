# Agent Note: 随附 web profile 中的 BrowserSkill

状态：已实现

[English](2026-09-12-browserskill-web-profile.md) | 中文

## 问题

差距审计发现 dsh 缺少 GUI／浏览器控制：浏览器自动化只存在于默认关闭的 Playwright MCP overlay 中，而它驱动的是无头的、未登录的浏览器。BrowserSkill（腾讯）随附第一方 dsh 插件（`@wxg-prc-cpg/browser-skill-dsh-plugin`），通过专用的 Agent Window 驱动真实的、已登录的浏览器——守护进程加扩展，没有 MCP 中转。该依赖已被加入 `dsh-web-app` 并在工作区供应链策略中固定版本，但没有任何东西挂载它：profile 的组合包层来自 profile 的 `dsh.profile.bundles` 列表，而没有任何随附模板列出了该包，因此插件自带的 `dsh.bundle.patch` 从未生效。

## 决策

把该插件作为第三个组合包层接入随附的 `web` profile：

- **模板。** `PROFILE_TEMPLATES.web.bundles` 变为 `dsh-base`、`dsh-web-app`、`@wxg-prc-cpg/browser-skill-dsh-plugin`。插件自带的 patch 插入其行；不改动任何产品 patch 文件。只有 web profile 变化——headless、sdk、acp 与 mcp 组合不受影响。
- **安装解析。** 组合包名先从 dsh 安装锚点解析，因此该插件被声明为 `apps/cli`（已发布的 `dsh` 包）的依赖，而不仅是 `dsh-web-app` 的依赖。版本通过工作区 `minimumReleaseAgeExclude` 策略固定在 `0.1.2`。
- **迁移。** 之前的精确 web 元组加入 `INSTALLATION_OWNED_PROFILE_TUPLES`，因此由早期版本写入的既有 `~/.dsh/profiles/web` 会在加载时被规范化到新模板。被用户编辑过 bundle 列表的 profile 绝不会被改写。
- **退化。** 插件把缺失的 `bsk` 二进制映射为带安装指引的友好工具错误，因此没有 BrowserSkill 技术栈的机器上的 web 会话按次调用失败，而不是启动失败。

web 前端无需手动组合：插件声明了 `dsh.client`（平台 web，inject client-runtime/ui-tool/ui-layout，external ui-attachment/ui-primitives），client 模块系统会自动从已加载条目组合 `./client` 包。

## 验证契约

profile 套件固定新的模板元组、退役元组的规范化（包括用户自有的 bundle 列表不被触碰）以及其余每个 profile 的模板不变。针对真实安装的组合检查解析出全部三个层、找到 `browserskill` 插入行并加载插件模块。无密钥快照套件（headless 与 sdk 泳道）不变地通过；web profile 启动的是用户在 2026-08-30 通过 profile 本地路由现场验证过的同一插件。

## 备选方案

**像 MCP 示例那样以默认关闭的 overlay 交付。** 否决：overlay 机制 patch 的是启动器树，而常驻工具行属于 preset 的 agent 平面；组合包层才是被认可的组合表面，且 BrowserSkill 的价值正是用户已经信任的已登录浏览器。

**把行直接挂进 `dsh-web-app` 的 patch。** 否决：插件自带 `dsh.bundle.patch` 正是为了让组合方只拥有"是否包含它"这一决策；在产品 patch 中复制其行会与上游清单漂移。

**在每个 profile 中暴露。** 否决：headless 与自动化 profile 运行在没有交互浏览器的地方；审计将该能力的范围限定为 web profile。

## 后果

每个新建的 web profile 都带有六个 `browser_*` 工具与 `browser-skill` skill；没有 `bsk` 技术栈的机器看到的是按次调用的安装指引而非启动失败。该依赖是随附模板中的第一个第三方组合包层，因此其升级路径通过工作区供应链策略固定版本，且只有当元组仍归安装所有时，升级才经由 profile 规范化机制流转。web profile 上的会话现在为浏览器任务依赖一个外部守护进程——profile 中的其他一切不变。
