# dsh-plugin-product-subagents

[English](README.md) | **简体中文**

面向 DeepSeek Harness 的**基于角色的 Codex / Claude Code / ACP 子代理插件**。把外部 Agent CLI 变成持久、可续聊的子代理:声明式角色库、按角色的产品权限、带权限天花板的委派、跨平台进程启动。

## 功能

- **可续聊子代理** — 同步 one-shot 或异步连续式(用 `send_message` / `list_agents` / `interrupt_agent` 控制;用 `product_wait` 同步 attach)。
- **会话连续性** — 子代理的远程产品会话在空闲释放与进程重启后仍可恢复(持久注册表 + 日志标记;claude/codex 按 id 恢复,ACP 重连)。
- **声明式角色**(`roles/*.json`)— `general`(默认)、`code-review`、`explore`(禁派)、`debug`。委派默认开启,角色可显式禁止;未知角色回退 `general`。
- **两层权限模型** — 中继模型永远是只读传话筒;`permissionMode`(`readonly` / `default` / `full`)作用于远程产品,映射到各产品自己的 CLI 标志。
- **权限天花板** — 子代理不能派生出比自己权限更高的后代。
- **任意 ACP Agent** — 通过 `config.providers` 加 Cursor(`agent acp`)、CodeBuddy(`cbc --acp`)、Gemini(`gemini --acp`)等,零代码。
- **资源管理** — 空闲释放、可配超时、并发上限。
- **跨平台** — Windows `.cmd` 垫片、Windows 安全路径转义;CI 覆盖 macOS / Ubuntu / Windows。

## 环境要求

- DeepSeek Harness 部署(web profile)。
- 至少一个产品 CLI 在 `PATH` 且已登录:`claude`、`codex`,或某个 ACP CLI(`opencode`、`agent`、`cbc`…)。
- Node ≥ 18。

## 安装

### 让 Agent 安装(一句话)

把这句粘贴给你的 DeepSeek Harness Agent(或任何有 shell 与 harness 目录文件权限的编码 Agent),它会自己完成所有步骤:

> 请把 `dsh-plugin-product-subagents` 插件装进我的 DeepSeek Harness web profile:在 `~/.dsh/profiles/web` 里执行 `npm i dsh-plugin-product-subagents`,然后在 `~/.dsh/profiles/web/cordis.patch.yml` 末尾追加一行 —— `- insert: [{id: product-subagents, name: 'dsh-plugin-product-subagents', config: {idleTimeoutMs: 600000}}]` —— 然后提醒我重启 harness 让插件生效。

这一句覆盖:装包进 profile、接线宿主层行、提示所需重启。(包发布前用本地变体:把行的 `name` 指向本仓库的 `lib/index.js` 即可。)

### 手动安装

```bash
npm i dsh-plugin-product-subagents
```

在 profile 的 `cordis.patch.yml` 加一行宿主层:

```yaml
- insert:
    - id: product-subagents
      name: 'dsh-plugin-product-subagents'
      config:
        idleTimeoutMs: 600000
        providers:
          cursor:    { type: acp, command: agent, args: [acp] }
          codebuddy: { type: acp, command: cbc, args: [--acp] }
```

## 快速开始

会话中的模型有六个工具:

| 工具 | 用途 |
|---|---|
| `product_delegate` | 按角色委派任务(同步或连续式) |
| `product_roles` | 列出角色库 |
| `product_submit` | 子代理内部桥(仅连续式子代理) |
| `subagent_progress` | 单个子代理的状态 + 内部 trace |
| `product_wait` | 阻塞直到子代理结算,返回答案 |
| `product_agents` | Provider 可用性 + 活跃子代理 |

```
product_delegate role=general task="重构 demo-project/calc.js 并运行测试"
product_wait subagent_id=<childId>
```

## 配置

```yaml
config:
  providers: { cursor: { type: acp, command: agent, args: [acp] } }
  idleTimeoutMs: 600000       # 结算后的子代理闲置超过此时长则释放远程会话(0 禁用)
  maxConcurrentChildren: 8    # 同时存在的连续式子代理上限
  rolesDir: <path>            # 声明式角色库目录(默认 roles/)
  registryPath: <path>        # 持久化远程会话注册表
```

## 角色与权限

每个角色文件:

```json
{
  "id": "code-review",
  "description": "审查代码的缺陷、安全与可维护性(只读)。",
  "provider": "claude-code",
  "permissionMode": "readonly",
  "allowDelegation": true,
  "instructions": "你是代码审查员。只读:绝不修改文件。…"
}
```

- `permissionMode` 映射到产品标志:`readonly`(claude `--permission-mode plan` / codex `--sandbox read-only`)、`full`(claude `--dangerously-skip-permissions` / codex `--dangerously-bypass-approvals-and-sandbox`)。
- **中继模型任何角色都拿不到可写工具**。
- **委派有天花板**:`readonly < default < full`;子代理不能派生出权限更高的后代。

## 自定义 ACP Provider

`config.providers` 接受任意讲 ACP 的 CLI —— 通用桥负责持久进程、`session/load` 恢复与死进程重连:

```yaml
providers:
  cursor:    { type: acp, command: agent, args: [acp] }    # Cursor CLI
  codebuddy: { type: acp, command: cbc, args: [--acp] }    # CodeBuddy
  gemini:    { type: acp, command: gemini, args: [--acp] } # Gemini CLI
  opencode:  { type: acp, command: opencode, args: [acp] } # opencode
```

只有命令在 `PATH` 上被检测到,Provider 才会出现在委派枚举里。内置三件套(`claude-code` / `codex` / `acp`)可用同名键覆盖。

## 开发

```bash
npm install
npm test        # node:test — 纯逻辑 + fake bridge,不需要 CLI 或密钥
npm run lint    # 语法检查所有模块
```

桥契约、权限模型与新增产品的方式见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。CI 在 macOS / Ubuntu / Windows × Node 18/20/22 上跑测试套件。

## 安全

这是**配置即信任边界**的工具:它会启动你配置的任何 CLI,`full` 会传递产品自己的"绕过所有权限检查"标志。见 [SECURITY.md](SECURITY.md)。

## License

MIT
