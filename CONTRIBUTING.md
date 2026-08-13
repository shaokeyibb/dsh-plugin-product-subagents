# Contributing

Thanks for your interest! This project is small on purpose: one plugin, three
bridge protocols, a role system, and a permission model.

## Getting started

```bash
git clone <repo>
cd dsh-plugin-product-subagents
npm install
npm test
```

## Where things live

- `lib/bridges/` — one bridge per product protocol (`claude`, `codex`, `acp`).
  Each implements the same interface: `create(cwd)`, `submit(remote, task,
  signal, cwd, settings)`, `reconnect(sessionId, cwd)`, `dispose(remote)`.
  **Adding a product = adding a bridge + a provider entry.**
- `lib/providers.js` — the config-driven provider registry (built-ins +
  custom ACP agents via `config.providers`).
- `lib/roles.js` + `roles/` — the declarative role library.
- `lib/tools/` — one module per model-facing tool.
- `lib/index.js` — `apply()`: wires providers, tools, lifecycle (idle
  disposal, registry, concurrency counter, permission ceiling).

## Design rules

1. **The relay model is always read-only.** Its toolFilter only ever contains
   `product_submit` plus `product_delegate` when the role allows delegation.
   Never add a write-capable tool to a child.
2. **Permissions inherit down the delegation tree.** A child may not spawn a
   descendant with a higher `permissionMode` (`readonly < default < full`).
3. **New behavior goes in plugins/tools, not the loop.** Follow the existing
   module layout; keep `index.js` thin.
4. **Cross-platform.** CLI launches go through `lib/run.js` (`spawnProduct`),
   which handles Windows `.cmd` shims; paths use `join()` and
   `fileURLToPath`. The CI matrix runs macOS/Linux/Windows.
5. **Tests must not need real product CLIs or API keys.** Unit-test the pure
   logic; use the fake bridge for integration tests.

## Before submitting

- `npm run lint` (syntax check all modules)
- `npm test`
- Update README / README.zh.md when the config surface changes
- Add a CHANGELOG entry
