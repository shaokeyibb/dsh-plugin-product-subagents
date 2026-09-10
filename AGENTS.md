# AGENTS.md

Guidance for AI agents (Claude Code, Codex, DeepSeek Harness agents, …)
working in this repository.

## What this is

`dsh-plugin-product-subagents` — a DeepSeek Harness (Cordis) plugin that turns
external agent CLIs (Claude Code, Codex, any ACP agent) into role-based,
continuable subagents: one-shot sync or async continuable, with durable
session recovery, per-role product permissions, and delegation capped by a
permission ceiling.

## Commands

```bash
npm install        # install dependencies
npm test           # node:test suite (pure logic + fake bridge; no CLIs/keys)
npm run lint       # syntax-check every module (node --check)

# acceptance run against one real DSH release, in a disposable $DSH_HOME
node scripts/verify-dsh-profile.mjs --dsh 0.1.5-alpha.2
```

Never add tests that require a real product CLI or an API key — the suite must
run green on CI (macOS / Ubuntu / Windows × Node 18/20/22) with no credentials.
The disposable-profile acceptance run is the deliberate exception and lives in
`scripts/`, outside `npm test`.

## Repo layout

```
lib/
  index.js            # apply(): wires providers, lifecycle, tools
  tools/              # one module per model-facing tool
  bridges/            # one bridge per product protocol (claude / codex / acp)
  providers.js        # config-driven provider registry (+ custom ACP agents)
  roles.js            # role library loader
  config.js           # zod config validation
  registry.js         # durable remote-session registry file
  run.js              # cross-platform process launching (Windows .cmd shims)
  availability.js     # CLI detection
  bindings.js         # child→remote binding map + log-marker recovery
  progress.js         # session-log folding (progress/trace/token usage)
  children.js         # listChildren() union: identity rows vs. diagnostics
  lossless.js         # stripUndefined(): tool results must be lossless JSON
roles/                # declarative role files (*.json)
test/                 # node:test suite
scripts/              # lint + the disposable-profile DSH acceptance run
docs/ARCHITECTURE.md  # bridge contract, permission model, adding products
docs/COMPATIBILITY.md # the DSH release matrix and how each verdict was produced
```

## Design rules (non-negotiable)

1. **The relay model is always a read-only pipe.** A child's toolFilter only
   ever contains `product_submit` plus `product_delegate` when the role allows
   delegation. Never add a write-capable tool to a child.
2. **Permissions are for the remote product.** `permissionMode`
   (`readonly` / `default` / `full`) maps to the product's own CLI flags.
3. **Never register a bare product id on `ctx.subagents`.** The plugin's
   provider keys (`claude-code`, `codex`, `acp`) are also the ids the official
   `@deepseek-ai/dsh-subagent-*` plugins use. `registerProvider` rejects a
   duplicate and that failure takes the whole profile's plugin tree down at
   boot, so every registration goes through `runtimeProviderName()` and stays
   additive and plugin-owned. Bridges, roles, bindings and the registry keep
   using the bare key.
4. **Permissions inherit down the delegation tree.** A child cannot spawn a
   descendant with a higher `permissionMode` — enforced in
   `lib/tools/product-delegate.js` (`PERM_RANK`).
5. **The bridge contract is fixed.** Every bridge in `lib/bridges/`
   implements `create(cwd)`, `submit(remote, task, signal, cwd, settings)`,
   `reconnect(sessionId, cwd)`, `dispose(remote)`. Adding a product = a new
   bridge + a provider entry; a plain ACP CLI needs no code at all
   (`config.providers`).
6. **Cross-platform.** All CLI launches go through `lib/run.js`
   (`spawnProduct` / `spawnSyncProduct`) — they handle Windows `.cmd` shims.
   Paths use `join()` and `fileURLToPath`, never string concatenation or
   `URL.pathname`.
7. **Session continuity is layered.** Remote session ids are captured as early
   as possible and durably recorded (binding → registry file → log marker).
   Do not break the recovery chain.

## Config surface

`config.providers` (add/override product CLIs), `providerNamespace`,
`idleTimeoutMs`, `maxConcurrentChildren`, `rolesDir`, `registryPath`. Roles live in `roles/*.json`
(`permissionMode`, `allowDelegation` defaults ON, `provider`, `instructions`,
`description`). Invalid config fails loudly via `lib/config.js` (zod).

## Conventions

- Keep `lib/index.js` thin; put tools in `lib/tools/`.
- Update README.md and README.zh.md together when the config surface changes.
- Add a CHANGELOG entry for user-visible changes.
- Every tool result must be strict lossless JSON — no `undefined` anywhere, at
  any depth. Return through `stripUndefined()` (`lib/lossless.js`) whenever a
  field can be absent; the harness rejects the whole call otherwise.
- No symlinks and no git submodules anywhere in the tree. The DSH STORE
  fixed-Commit contract requires ordinary files, and a symlink defers the
  store's automatic update. `CLAUDE.md` is a regular pointer file for exactly
  this reason — keep the guidance itself here in `AGENTS.md`.
- A release that claims support for a DSH version must have the acceptance run
  behind it: verify, record the verdict in `dsh.compatibility.dshReleases` AND
  in `docs/COMPATIBILITY.md`, then bump the SemVer. The store only reads the
  matrix at a new pinned commit.
- Commit with identity `HikariLan <i@hikarilan.life>`; the repo deliberately
  keeps a single squashed commit until first release.
