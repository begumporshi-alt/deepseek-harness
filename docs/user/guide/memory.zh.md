# 持久记忆

[English](memory.md) | 中文

这些**默认关闭的可选覆盖层**让 DSH 拥有跨会话的持久记忆：关于你的事实、你给过的反馈和你的项目约束都会进入未来的每个会话。记忆使用第一方包——不依赖第三方服务——并在项目的 `.dsh/memory/` 目录下为每条记忆存储一个 markdown 文件。

## 启用一个

```sh
dsh web --patch "$PWD/apps/cli/config/examples/memory/cordis.yml"
```

该 overlay 通过一个 patch 加载记忆服务、本地文件系统提供方和模型可见的工具。默认 profile 不包含任何记忆内容；不传 `--patch` 就会让记忆保持关闭。若要跨次运行保留所选配置，请按[记忆 MCP 指南](./mcp-memory.zh.md)的说明把该 overlay 的 `insert` patch 合并到用户 patch 层——分层说明完全一致。

## 模型会得到什么

启用后，模型会看到四个工具——`memory_save`、`memory_search`、`memory_list` 与 `memory_forget`——并且从第二个会话起，会话开始时会注入一条已记住事实的索引。请为每项能力使用一条提示词验证：

1. 在会话 A 中提问：`记住我的验证饮品是 lapsang-<唯一后缀>。` 模型应调用 `memory_save`。
2. 在同一项目目录下打开会话 B（新会话即可，无需重启 Host）。会话开始的索引应列出该事实。
3. 在会话 B 中提问：`我的验证饮品是什么？查一下记忆。` 模型应调用 `memory_search` 或 `memory_list`，并根据记忆作答。

## 数据在哪里

每条记忆都是 `<projectRoot>/.dsh/memory/entries/` 下带简短 frontmatter 头的一个 markdown 文件。你可以用任何编辑器查看；文件被删除或修改后，下次读取即会生效。记忆有上限（默认单条 4,000 字符、每次列出 200 条），可通过 overlay 的 `config` 块调整——全部受支持字段见[配置目录](../../config-catalog.zh.md#deepseek-aidsh-memory-local)。

记忆按项目划分：存储目录位于工作目录最近的 `.git` 祖先之下，不同项目各自持有独立记忆。

## 已知边界

搜索是大小写不敏感的子串匹配，不是语义召回。会话开始的索引每次会话只发布一次；会话中途保存的事实会通过工具结果呈现，并在下一个会话进入索引。要移除该能力，停止传入 overlay 即可。
