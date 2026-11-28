# dsh-plugin-product-subagents

[English](README.md) | **简体中文**

让 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 把任务委派给 Codex、Claude Code 或兼容 ACP 的 CLI。任务可以单次运行，也可以交给后台子代理，之后继续对话。角色提供任务指令，并为 Codex 和 Claude Code 设置权限模式。

## 安装

使用[兼容的 DSH 版本](docs/COMPATIBILITY.md)，确保至少一个受支持的 CLI 在 `PATH` 中并已完成所需的认证。

```bash
dsh plugin --profile web add dsh-plugin-product-subagents
```

如果使用其他 Profile，把 `web` 换成相应名称。安装后重启 DSH。

## 快速开始

在 DSH 会话中，可以让代理用 Codex 和 `code-review` 角色审查当前的代码改动。

- 用 `product_agents` 查看可用的 CLI，用 `product_roles` 查看可用角色。
- `product_delegate` 默认在后台运行并返回子代理 ID。用 `product_wait` 等待结果，或用 `send_message` 继续对话。设置 `background: false` 可同步获取本次结果。

## 文档

[角色、提供方和工具](docs/ARCHITECTURE.md) · [安全说明](SECURITY.md) · [参与贡献](CONTRIBUTING.md) · [更新日志](CHANGELOG.md) · [MIT 许可证](LICENSE)
