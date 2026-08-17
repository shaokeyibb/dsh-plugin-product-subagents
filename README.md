# dsh-plugin-product-subagents

**English** | [简体中文](README.zh.md)

Role-based **Codex / Claude Code / ACP** subagent providers for the DeepSeek
Harness. Turns external agent CLIs into durable, continuable subagents with a
declarative role library, per-role product permissions, delegation with a
permission ceiling, and cross-platform process launching.

## Features

- **Continuable children** — one-shot sync or async continuable (control with
  `send_message`, `list_agents`, `interrupt_agent`; attach synchronously with
  `product_wait`).
- **Session continuity** — a child's remote product session survives idle
  disposal and process restarts (durable registry + log markers; claude/codex
  resume by id, ACP reconnects).
- **Declarative roles** (`roles/*.json`) — `general` (default), `code-review`,
  `explore` (never delegates), `debug`. Delegation defaults ON; a role can ban
  it. Unknown roles fall back to `general`.
- **Two-layer permission model** — the relay model is always a read-only
  pipe; `permissionMode` (`readonly` / `default` / `full`) applies to the
  remote product and is mapped to each product's own CLI flags.
- **Permission ceiling** — a child can never spawn a descendant with more
  permission than it has.
- **Any ACP agent** — add Cursor (`agent acp`), CodeBuddy (`cbc --acp`),
  Gemini (`gemini --acp`) and more via `config.providers`; no code needed.
- **Resource management** — idle disposal, configurable timeouts, concurrency
  cap.
- **Cross-platform** — Windows `.cmd` shims, Windows-safe path escaping;
  CI runs macOS / Ubuntu / Windows.

## Requirements

- A DeepSeek Harness deployment (web profile).
- At least one product CLI on `PATH` and authenticated: `claude`, `codex`, or
  an ACP CLI (`opencode`, `agent`, `cbc`, …).
- Node ≥ 18.

## Install

### Recommended — `dsh plugin add`

```bash
dsh plugin --profile web add dsh-plugin-product-subagents
```

That single command installs the package **and** wires the host-plane row
automatically: the plugin ships a `cordis.patch.yml` declared via
`dsh.bundle` in its `package.json`, so `dsh plugin add` registers it as a
profile layer (no manual `cordis.patch.yml` editing needed). Restart the
harness afterwards so the plugin loads.

To customise the plugin (e.g. add ACP providers), target the `product-subagents`
id in your profile's own `cordis.patch.yml` (`~/.dsh/profiles/web/cordis.patch.yml`):

```yaml
- id: product-subagents
  config:
    idleTimeoutMs: 600000
    providers:
      cursor:    { type: acp, command: agent, args: [acp] }
      codebuddy: { type: acp, command: cbc, args: [--acp] }
```

> **Note:** a config override replaces the row's whole `config` object, so
> restate any keys you wish to keep (like `idleTimeoutMs` above).

### Install via your agent (one line)

Paste this to your DeepSeek Harness agent (or any coding agent with shell
access to the harness home) — it performs every step itself:

> Install the `dsh-plugin-product-subagents` plugin into my DeepSeek Harness
> web profile: run `dsh plugin --profile web add dsh-plugin-product-subagents`,
> then tell me to restart the harness so the plugin loads.

### Manual (advanced)

If you prefer to manage the profile yourself, use pnpm (not npm) inside the
profile directory so peer dependencies are not auto-installed:

```bash
cd ~/.dsh/profiles/web
pnpm add dsh-plugin-product-subagents
```

Then add a host-plane row to your profile's `cordis.patch.yml`:

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

## Quick start

In a session, the model has six tools:

| Tool | Purpose |
|---|---|
| `product_delegate` | delegate a task under a role (sync or continuable) |
| `product_roles` | list the role library |
| `product_submit` | per-child bridge (continuable children only) |
| `subagent_progress` | status + internal trace of one child |
| `product_wait` | block until a child settles, return its answer |
| `product_agents` | provider availability + live children |

```
product_delegate role=general task="Refactor demo-project/calc.js and run its tests"
product_wait subagent_id=<childId>
```

## Configuration

```yaml
config:
  providers: { cursor: { type: acp, command: agent, args: [acp] } }
  idleTimeoutMs: 600000       # settled children release their remote session
                              # after this idle period (0 disables)
  maxConcurrentChildren: 8    # cap on simultaneous continuable children
  rolesDir: <path>            # declarative role library (default: roles/)
  registryPath: <path>        # durable remote-session registry
```

## Roles and permissions

Each role file:

```json
{
  "id": "code-review",
  "description": "Review code for bugs, security, maintainability (read-only).",
  "provider": "claude-code",
  "permissionMode": "readonly",
  "allowDelegation": true,
  "instructions": "You are a code reviewer. READ-ONLY: never modify files. …"
}
```

- `permissionMode` maps to product flags: `readonly` (claude
  `--permission-mode plan` / codex `--sandbox read-only`), `full` (claude
  `--dangerously-skip-permissions` / codex
  `--dangerously-bypass-approvals-and-sandbox`).
- **The relay model never gets write-capable tools**, in every role.
- **Delegation is capped**: `readonly < default < full`; a child cannot spawn
  a descendant with a higher mode.

## Custom ACP providers

`config.providers` accepts any ACP-capable CLI — the generic bridge handles a
persistent process, `session/load` resume, and dead-process reconnect:

```yaml
providers:
  cursor:    { type: acp, command: agent, args: [acp] }    # Cursor CLI
  codebuddy: { type: acp, command: cbc, args: [--acp] }    # CodeBuddy
  gemini:    { type: acp, command: gemini, args: [--acp] } # Gemini CLI
  opencode:  { type: acp, command: opencode, args: [acp] } # opencode
```

Providers appear in the delegation enum only when their command is detected
on `PATH`. Built-ins (`claude-code`, `codex`, `acp`) can be overridden with
the same keys.

## Development

```bash
npm install
npm test        # node:test — pure logic + fake bridge, no CLIs or keys
npm run lint    # syntax-check every module
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the bridge contract, the
permission model, and how to add products. CI runs the suite on macOS /
Ubuntu / Windows × Node 18/20/22.

## Security

This is a **configuration-as-trust-boundary** tool: it spawns whatever CLIs
you configure, and `full` passes the products' own "bypass all permission
checks" flags. See [SECURITY.md](SECURITY.md).

## License

MIT
