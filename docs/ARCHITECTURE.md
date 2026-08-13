# Architecture

This plugin is a DeepSeek Harness (Cordis) plugin that turns external
agent CLIs (Claude Code, Codex, any ACP agent) into **continuable product
subagents** with a role-based permission model.

## Big picture

```
                ┌────────────────────────────────────────────────┐
                │            dsh-plugin-product-subagents         │
                │                                                │
  root session  │  product_delegate ──► harness continuation ──► │
  (the model)   │                        manager (in-process     │
      │         │                        child = relay model)    │
      │ report  │        ┌──────────────┐  product_submit        │
      │◄────────┤        │ relay model  │───────────────────────►│  bridge
      │         │        │ (deepseek,   │   task text + settings │  (claude/
      │         │        │  read-only   │                        │   codex/
      │         │        │  pipe)       │◄───────────────────────┤   acp)
      │         │        └──────────────┘   answer + marker      │
      └─────────┴────────────────────────────────────────────────┘
                     child session ◄─binding──► remote session
```

- **The relay model is always a read-only pipe.** Its toolFilter only ever
  contains `product_submit` (plus `product_delegate` when the role allows
  delegation). It never receives write-capable tools. All real work happens
  in the remote product.
- **Permissions are for the remote product.** `permissionMode` per role maps
  to the product's own CLI flags (`readonly` / `default` / `full`).
- **Permissions inherit down the delegation tree.** A child cannot spawn a
  descendant with more permission than it has.

## Bridge interface

Every product is one bridge module in `lib/bridges/` implementing:

```ts
interface Bridge {
  create(cwd): Promise<Remote>                       // start a fresh remote session
  submit(remote, task, signal, cwd, settings): Promise<{ text, stopReason }>
  reconnect(sessionId, cwd): Promise<Remote>         // resume a persisted session
  dispose(remote): Promise<void>                     // release the remote session
}
```

`settings` carries `{ model?, reasoningEffort?, permissionMode? }`. The
permission flags are translated per product inside the bridge.

**Adding a product** = add a bridge + register it in `lib/providers.js`
(built-in) or declare it via `config.providers` (any ACP CLI, no code).

## Session continuity

A child's remote session id is captured at the earliest possible moment and
durably recorded:

1. **in-memory binding** (child session id → remote handle) — fast path
2. **durable registry file** (`registryPath`, default
   `~/.dsh/product-subagents-registry.json`) — survives idle disposal and
   restarts; written as soon as the remote id is known
3. **session-log marker** (`PRODUCT_SESSION:<product>:<id>` in product_submit
   results) — last-resort fallback

Idle disposal releases a settled child's remote session after
`idleTimeoutMs`; reuse cancels the pending release.

## Role system

`roles/*.json` (or `config.rolesDir`):

```json
{
  "id": "code-review",
  "description": "…",
  "provider": "claude-code",
  "permissionMode": "readonly",
  "allowDelegation": true,
  "instructions": "… (sent to the remote product)"
}
```

- `allowDelegation` defaults **ON**; `false` bans it (e.g. `explore`).
- `permissionMode` ordering: `readonly < default < full`.
- Unknown role ids fall back to `general`.

## Tools

| Tool | Purpose |
|---|---|
| `product_delegate` | role-aware delegation (one-shot sync / continuable async) |
| `product_roles` | list the role library |
| `product_submit` | per-child bridge (children only) |
| `subagent_progress` | status + internal trace + token usage of one child |
| `product_wait` | attach to a child and block until it settles |
| `product_agents` | provider availability + live children |

## Lifecycle

- Providers are registered only for CLIs detected on PATH.
- `subagent/end` → decrement the concurrency counter and schedule idle
  disposal; `product_submit` reuse cancels it.
- Plugin teardown disposes every live remote session.

## Cross-platform

CLI launches go through `lib/run.js` `spawnProduct`/`spawnSyncProduct`, which
on Windows run `.cmd` shims through `cmd.exe /d /s /c` with verbatim args and
quote any arg containing spaces or cmd metacharacters. Paths use `join()` and
`fileURLToPath`. The CI matrix (macOS / Ubuntu / Windows × Node 18/20/22)
runs the test suite on all platforms.
