# Changelog

All notable changes to this project are documented in this file.

## [0.4.0] — 2026-09-10

Compatibility release for the current DeepSeek Harness line, and the DSH STORE
fixed-Commit contract (AI-Scarlett/DSH-Store#683).

### Added
- `config.providerNamespace` — the namespace for the ids registered on
  `ctx.subagents` (default `product-subagents`; `''` registers the bare keys).
- `dsh.compatibility` in `package.json`: the declared Node.js range, the DSH
  SemVer range, and `dshReleases` — a per-release `compatible` /
  `incompatible` / `unknown` verdict for every published `@deepseek-ai/dsh`
  release. DSH STORE reads this matrix from the pinned commit; a range alone is
  not installable evidence.
- `scripts/verify-dsh-profile.mjs` + `scripts/verify-plugin.mjs`: a
  disposable-profile acceptance run behind every `compatible` verdict. For one
  DSH release it creates a throwaway `$DSH_HOME`, installs the packed tarball
  with the real `dsh plugin add`, checks the composed profile tree, **boots**
  the profile with the verifier overlaid as a `--patch` layer (asserting the six
  tools are registered, the providers reached the real `SubagentRuntime`, and
  that `product_roles` / `product_agents` execute, schema-validate and carry no
  `undefined`), then uninstalls and asserts the bundle layer is gone. No API key
  needed; not part of `npm test`, which stays credential-free and CLI-free.
- `docs/COMPATIBILITY.md`: what each verdict means, how to reproduce one, what
  it does not prove, and how to keep the matrix current.

### Fixed
- **A profile that also loaded an official `@deepseek-ai/dsh-subagent-*` plugin
  could not boot at all.** This plugin registered its providers under the bare
  ids `claude-code`, `codex` and `acp` — the same ids
  `@deepseek-ai/dsh-subagent-claude-code` / `-codex` / `-acp` register under.
  `registerProvider` rejects a duplicate id, and that rejection fails the
  loader entry, so the whole profile's plugin tree went down with
  `a subagent provider named "claude-code" is already registered` — the harness,
  not just this plugin. Registrations are now namespaced into ids this plugin
  owns (`product-subagents:claude-code`), which is additive and never shadows or
  impersonates an official id; verified booting alongside the official
  claude-code and codex subagent plugins in one profile.

  Nothing in this plugin's own surface moved: roles, `config.providers` keys,
  the `product_delegate` `provider` argument and the durable session registry
  all still use the bare key. Only the provider names seen in the harness-wide
  `subagent` tool changed. `config.providerNamespace: ''` restores the old bare
  ids for a profile with no official product subagent plugin loaded.
- **Peer ranges excluded every DSH release after `0.1.0-rc.8`.**
  `^0.1.0-rc.6` is a prerelease-anchored caret: under SemVer a prerelease only
  satisfies a comparator sharing its exact `major.minor.patch` tuple, so
  `0.1.2-rc.1`, `0.1.3-alpha.2` and `0.1.5-alpha.*` all failed the range and
  installed with an unmet-peer warning. `@deepseek-ai/dsh-subagent` and
  `@deepseek-ai/dsh-tools` now enumerate every supported release line, and
  `@deepseek-ai/cordis` accepts `^4.0.1-rc.4` and up (dsh-tools requires
  `^4.0.2` since `0.1.2-rc.1`). The declared range now covers every installable
  DSH release from `0.0.1-rc.5` through `0.1.5-rc.1`, each verified
  individually — see [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md).
- `listChildren()` diagnostic rows are no longer reported as children.
  The listing is a union: a `child` row carries `activity` / `mode` / `label`,
  while a `diagnostic` row carries only an id and a reason (its descriptor was
  unreadable or transiently unavailable). `product_agents` listed those rows as
  children with missing fields, and `subagent_progress` / `product_wait` could
  match one and report a fabricated status. All three now go through
  `lib/children.js` and see identity-bearing rows only.
- `CLAUDE.md` is a regular file instead of a symlink to `AGENTS.md`. The DSH
  STORE fixed-Commit contract requires ordinary files in the pinned source tree;
  the symlink deferred the 0.3.2 update with `package contains symbolic links`.
  Guidance still lives only in `AGENTS.md`.

### Changed
- The subagent provider now states every `SubagentCapabilities` key explicitly
  (`agentOptions`, `outputSchema` and `depthLimit` alongside `persona` and
  `toolFilter`) instead of leaving them to fall through as `undefined`, so a
  capability added upstream is a deliberate decision here. `agentOptions` is
  `false` on purpose: `model` / `reasoning_effort` are forwarded to the remote
  product CLI, never to a host Agent.

## [0.3.2] — 2026-09-09

### Fixed
- `subagent_progress` and `product_wait` no longer fail with
  `value is not lossless JSON` when polling an active `claude` product child.
  Both tools built their result from optional fold fields (`mode`, `label`,
  `turn`, `lastTask`, `trace`, `inFlight`, `stopReason`, ...) that are
  legitimately `undefined` whenever a child has no local session snapshot — the
  normal case for a `claude` child, whose events live in the remote CLI. The
  harness validates every tool result as strict lossless JSON, so a single
  `undefined` value threw on every poll, breaking watchable delegation. Results
  are now passed through a shared `stripUndefined` helper (`lib/lossless.js`)
  that recursively drops `undefined` keys/elements before returning.
- `product_agents` failed the same way: a listed child with no product binding
  (a plain subagent, or one whose binding was idle-disposed) left `product`,
  `mode` and `label` `undefined` in the children array, and an undetected
  provider left `auth`/`note` `undefined` in the availability view. Its result
  now goes through the same `stripUndefined` helper.

Thanks to @kaiomp for the report and the fix (#4, #5).

## [0.3.1] — 2026-08-17

### Added
- Declare `dsh.bundle` in `package.json` and ship a `cordis.patch.yml` bundle
  patch. `dsh plugin --profile <name> add dsh-plugin-product-subagents` now
  automatically wires the plugin as a profile layer — no manual
  `cordis.patch.yml` editing required, and the "declares no dsh.bundle"
  warning is gone.

### Changed
- README (EN + zh): the recommended install method is now
  `dsh plugin --profile web add dsh-plugin-product-subagents`. The manual
  fallback switched from `npm i` to `pnpm add` with an explanation of why npm
  breaks the harness singleton (it auto-installs peer dependencies, shadowing
  the host's `@deepseek-ai/dsh-tools` symlink — the same root cause as #3).

### Notes
- Issue #3's code fix shipped in 0.3.0 (dsh-tools moved to `peerDependencies`),
  but `dsh plugin add` still resolved to 0.2.0 on machines running pnpm 11:
  pnpm 11 enables `minimumReleaseAge` by default, and 0.3.0 was too new to
  pass the age gate, so pnpm fell back to 0.2.0 (which has dsh-tools in
  `dependencies` and reproduces the crash). Once 0.3.0+ ages past the
  threshold the problem disappears; until then, pin explicitly with
  `dsh plugin --profile web add dsh-plugin-product-subagents@0.3.0`.

## [0.3.0] — 2026-08-17

### Fixed
- Windows: `winArgs()` wraps the whole `cmd /S /C` invocation in one outer
  pair of quotes, so `/S` strips exactly that pair instead of the command's
  own quotes. `product_delegate` (claude-code / codex) no longer fails with
  `'claude" -p ...' is not recognized` (fixes #1).
- Move `@deepseek-ai/dsh-tools` from `dependencies` to `peerDependencies`: the
  harness core package must share a singleton with the host, and a second
  pnpm-installed copy in the profile shadowed the symlink and crashed every
  tool call with `Cannot read properties of undefined (reading 'prepare')`
  (fixes #3).

## [0.2.0] — 2026-08-13

Open-source release restructuring.

### Added
- Standalone npm package (`dsh-plugin-product-subagents`), MIT licensed.
- Unit test suite (`node --test`) with a fake bridge; no product CLIs needed.
- GitHub Actions CI matrix (macOS / Ubuntu / Windows).
- Config validation (`zod`) for `providers`, roles, and plugin config.
- Bilingual README (EN + zh), CONTRIBUTING, SECURITY, ARCHITECTURE docs.
- Split `lib/index.js` into `lib/tools/*` (one module per tool).

## [0.1.0]

### Added
- Config-driven provider registry: built-in `claude-code`, `codex`, `acp` plus
  custom ACP agents via `config.providers` (e.g. `agent acp`, `cbc --acp`,
  `gemini --acp`).
- Declarative role library (`roles/*.json`): `general` (default, full
  permissions, may delegate), `code-review` (readonly), `explore` (readonly,
  never delegates), `debug` (default). Delegation defaults ON; `false` bans it.
- Role-based product permissions (`readonly` / `default` / `full`) mapped to
  each product's own CLI flags; the relay model is always a read-only pipe.
- Delegation permission ceiling: a child cannot spawn a descendant with more
  permission than it has.
- Continuable children with durable session recovery (registry file +
  session-log markers), idle disposal of remote sessions, configurable
  per-product timeouts, and a concurrency cap.
- Tools: `product_delegate`, `product_roles`, `product_submit`,
  `subagent_progress`, `product_wait`, `product_agents`.
- Cross-platform process launching (Windows `.cmd` shims via `cmd.exe`),
  Windows-safe path escaping, `fileURLToPath` for module paths.
