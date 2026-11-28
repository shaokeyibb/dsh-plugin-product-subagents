# dsh-plugin-product-subagents

**English** | [简体中文](README.zh.md)

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that delegates work to Codex, Claude Code, or a compatible ACP CLI. Run a task once or keep a background subagent for follow-up. Roles supply task instructions and set permission modes for Codex and Claude Code.

## Install

Use a [compatible DSH version](docs/COMPATIBILITY.md) and have at least one supported CLI on `PATH` with its authentication set up.

```bash
dsh plugin --profile web add dsh-plugin-product-subagents
```

Replace `web` with your profile name if needed, then restart DSH.

## Quick start

In a DSH session, ask your agent to use Codex and the `code-review` role to review your current diff.

- `product_agents` shows available CLIs. `product_roles` lists available roles.
- `product_delegate` runs in the background by default and returns a child ID. Use `product_wait` to get the result or `send_message` to follow up. Set `background: false` for a one-shot result.

## Docs

[Roles, providers, and tools](docs/ARCHITECTURE.md) · [Security](SECURITY.md) · [Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md) · [MIT license](LICENSE)
