# DSH compatibility

This plugin declares its DeepSeek Harness compatibility in `package.json` under
`dsh.compatibility`, and every `compatible` entry in `dsh.compatibility.dshReleases`
is backed by an acceptance run in a **disposable profile** — not by a version
range alone.

```jsonc
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },
  "compatibility": {
    "node": ">=18",
    "dsh": "…",            // the SemVer range the plugin targets
    "dshReleases": { … }   // per-release verdict: compatible | incompatible | unknown
  }
}
```

`dshReleases` is a per-release verdict, not a range: a release absent from the
map is `unknown`, which is what an untested release deserves. `unknown` is never
upgraded to `compatible` without a run.

## How a verdict is produced

```bash
node scripts/verify-dsh-profile.mjs --dsh 0.1.5-alpha.2
node scripts/verify-dsh-profile.mjs --dsh 0.1.5-alpha.2,0.1.3-alpha.2 --json report.json

# coexistence with the official product subagent plugins in one profile
node scripts/verify-dsh-profile.mjs --dsh 0.1.5-alpha.2 \
  --with @deepseek-ai/dsh-subagent-claude-code@0.1.5-alpha.2,@deepseek-ai/dsh-subagent-codex@0.1.5-alpha.2
```

For each release the driver creates a throwaway `$DSH_HOME`, then runs four
steps and fails the release on the first one that does not hold:

| Step | What it proves |
|---|---|
| `install` | `dsh plugin --profile headless add <tarball>` succeeds **and** the profile manifest gained `dsh-plugin-product-subagents` in `dsh.profile.bundles` — the `dsh.bundle.patch` declaration is honoured by that release's CLI. |
| `compose` | `dsh --profile headless --dump-config` composes a tree containing the plugin's row — the bundle patch layers correctly under that release's loader. |
| `start` | The profile actually **boots** with `scripts/verify-plugin.mjs` overlaid via `--patch`. Inside the running harness it asserts all six tools are registered, the subagent providers reached the real `SubagentRuntime`, and `product_roles` / `product_agents` execute, validate against their declared output schema, render, and contain no `undefined` (strict lossless JSON). |
| `uninstall` | `dsh plugin … remove` succeeds and the bundle layer is gone from the manifest again. |

`--with <pkg>[,<pkg>]` co-installs other bundles into the same profile. The
`start` step then also asserts that every id this plugin registered is
namespaced and plugin-owned — the check that keeps it from colliding with the
official `@deepseek-ai/dsh-subagent-*` provider ids, a collision that failed the
entire profile's plugin tree at boot before 0.4.0.

The disposable `$DSH_HOME` is deleted afterwards (`--keep` retains it for
inspection). Nothing touches the user's real `~/.dsh`.

Because a boot needs no model call to reach this point, the run needs **no API
key**. It does read the product CLIs present on the machine, which is why it is
deliberately not part of `npm test` — that suite stays credential-free,
CLI-free and CI-safe.

## What the run does not prove

An acceptance run proves the plugin loads, registers, and answers under that
release. It is not a security audit, and it does not exercise a live delegation
to a product CLI (that needs a real `claude` / `codex` / ACP session and the
credentials behind it). Bridge behaviour is covered by `npm test` against a
fake bridge.

## Recorded results

Every result below comes from `scripts/verify-dsh-profile.mjs` on macOS 26.5.2
(darwin arm64), Node 24.16.0, pnpm 11.17.0, with `claude`, `codex` and
`opencode` present on `PATH`. Recorded 2026-09-10 for plugin 0.4.0.

| `@deepseek-ai/dsh` | Verdict | Evidence |
|---|---|---|
| `0.1.5-rc.1` | `compatible` | install · compose · start · uninstall — also verified alongside the official `@deepseek-ai/dsh-subagent-claude-code` + `-codex` plugins in one profile |
| `0.1.5-alpha.2` | `compatible` | install · compose · start · uninstall — also verified in a `web` profile, and alongside the official claude-code + codex subagent plugins in one profile |
| `0.1.5-alpha.1` | `compatible` | install · compose · start · uninstall |
| `0.1.3-alpha.2` | `compatible` | install · compose · start · uninstall |
| `0.1.3-alpha.1` | `unknown` | no longer published to npm; it cannot be installed, so it cannot be tested |
| `0.1.2-rc.1` | `compatible` | install · compose · start · uninstall |
| `0.1.2-alpha.5` | `compatible` | install · compose · start · uninstall |
| `0.1.2-alpha.4` | `compatible` | install · compose · start · uninstall |
| `0.1.2-alpha.3` | `compatible` | install · compose · start · uninstall |
| `0.1.2-alpha.2` | `compatible` | install · compose · start · uninstall |
| `0.1.1-rc.2` | `compatible` | install · compose · start · uninstall |
| `0.1.1-rc.1` | `compatible` | install · compose · start · uninstall |
| `0.1.0-rc.8` | `compatible` | install · compose · start · uninstall |
| `0.1.0-rc.7` | `compatible` | install · compose · start · uninstall |
| `0.1.0-rc.6` | `compatible` | install · compose · start · uninstall |
| `0.1.0-rc.3` | `compatible` | install · compose · start · uninstall |
| `0.1.0-rc.2` | `compatible` | install · compose · start · uninstall |
| `0.0.1-rc.5` | `compatible` | install · compose · start · uninstall — this release's `headless` template loads the official claude-code subagent, so it only boots since the provider ids became plugin-owned in 0.4.0 |
| `0.0.1-rc.3` | `unknown` | never published as `@deepseek-ai/dsh` |
| `0.0.1-rc.2` | `unknown` | not installable: its own dependency `@deepseek-ai/dsh-agent-tool-mode@^0.0.1-rc.2` has been unpublished |
| `0.0.1-rc.1` | `unknown` | not installable: its own dependency `@deepseek-ai/dsh-agent-tool-mode@^0.0.1-rc.1` has been unpublished |

An `unknown` here is always "could not be obtained", never "did not work" — an
untested release is never recorded as `compatible`, and a release that could not
be installed is never recorded as `incompatible`.

## Keeping this current

DSH STORE reads `dsh.compatibility.dshReleases` from the **pinned commit** of a
release, and unlists a plugin when none of the three most recent DSH releases
has an exact `compatible` record. So when a new DSH release appears:

1. `node scripts/verify-dsh-profile.mjs --dsh <new version>`
2. add the verdict to `dsh.compatibility.dshReleases` and the table above,
3. bump the plugin SemVer and cut a release — the matrix only takes effect at a
   new pinned commit.
