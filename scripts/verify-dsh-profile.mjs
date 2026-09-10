/**
 * Disposable-profile acceptance run for one DSH release.
 *
 * Packs this checkout, installs the tarball into a throwaway `$DSH_HOME`
 * profile with the real `dsh plugin` CLI, checks the composed profile tree,
 * boots the profile with `scripts/verify-plugin.mjs` overlaid as a `--patch`
 * layer, then uninstalls and asserts the bundle layer is gone again.
 *
 * This is deliberately NOT part of `npm test`: it downloads DSH, spawns pnpm,
 * and reads the product CLIs present on this machine. `npm test` must stay
 * runnable on CI with no network beyond npm, no credentials and no CLIs.
 *
 *   node scripts/verify-dsh-profile.mjs --dsh 0.1.5-alpha.2 [--profile headless] [--keep]
 *   node scripts/verify-dsh-profile.mjs --dsh 0.1.5-alpha.2,0.1.3-alpha.2 --json out.json
 *
 * `--with <pkg>[,<pkg>]` co-installs other bundles into the same profile — use
 * it to prove coexistence with the official `@deepseek-ai/dsh-subagent-*`
 * plugins, whose provider ids this plugin must not collide with.
 *
 * Exit code 0 only when every step of every requested release passed.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const root = fileURLToPath(new URL('..', import.meta.url))
const scripts = join(root, 'scripts')

/** Minimal `--flag value` parsing; unknown flags are a hard error. */
function parseArgs(argv) {
  const options = { dsh: [], profile: 'headless', keep: false, json: undefined, with: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--dsh') options.dsh = String(argv[++i] || '').split(',').filter(Boolean)
    else if (arg === '--profile') options.profile = String(argv[++i] || 'headless')
    else if (arg === '--json') options.json = String(argv[++i] || '')
    else if (arg === '--with') options.with = String(argv[++i] || '').split(',').filter(Boolean)
    else if (arg === '--keep') options.keep = true
    else throw new Error(`unknown argument: ${arg}`)
  }
  if (options.dsh.length === 0) throw new Error('pass at least one release: --dsh <version>[,<version>…]')
  return options
}

/** Run a command, capturing both streams; never throws on a nonzero exit. */
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8', shell: process.platform === 'win32', ...options,
  })
  return {
    code: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error ? String(result.error.message) : undefined,
  }
}

/** `npm pack` this checkout into `dir`; returns the tarball path. */
function packPlugin(dir) {
  const out = execFileSync('npm', ['pack', '--pack-destination', dir], { cwd: root, encoding: 'utf8' })
  const file = out.trim().split('\n').pop().trim()
  return join(dir, file)
}

/** The profile manifest's current bundle-layer list. */
function bundles(profileDir) {
  try {
    const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
    return manifest.dsh?.profile?.bundles ?? []
  } catch { return [] }
}

/** One release: install → compose → start → uninstall, in a fresh DSH_HOME. */
function verifyRelease(version, options, tarball) {
  const home = mkdtempSync(join(tmpdir(), `dsh-verify-${version.replace(/[^\w.-]/g, '')}-`))
  const env = { ...process.env, DSH_HOME: home, DSH_VERIFY_VERSION: version }
  const dsh = ['-y', `@deepseek-ai/dsh@${version}`]
  const profileDir = join(home, 'profiles', options.profile)
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const steps = []
  const step = (name, ok, detail) => { steps.push({ step: name, ok, detail }); return ok }

  try {
    // ── install ───────────────────────────────────────────────────────────
    const install = run('npx', [...dsh, 'plugin', '--profile', options.profile, 'add', ...options.with, tarball], { env })
    const layered = bundles(profileDir).includes(pkg.name)
    if (!step('install', install.code === 0 && layered, {
      exitCode: install.code, bundles: bundles(profileDir), tail: install.stderr.trim().split('\n').slice(-3),
    })) return { version, ok: false, home, steps }

    // ── compose ───────────────────────────────────────────────────────────
    const dump = run('npx', [...dsh, '--profile', options.profile, '--dump-config'], { env })
    const composed = dump.stdout.includes(`name: ${pkg.name}`)
    if (!step('compose', dump.code === 0 && composed, {
      exitCode: dump.code, foundEntry: composed, tail: dump.stderr.trim().split('\n').slice(-3),
    })) return { version, ok: false, home, steps }

    // ── start ─────────────────────────────────────────────────────────────
    mkdirSync(profileDir, { recursive: true })
    copyFileSync(join(scripts, 'verify-plugin.mjs'), join(profileDir, 'verify-plugin.mjs'))
    writeFileSync(join(profileDir, 'verify.patch.yml'),
      "- insert:\n    - id: product-subagents-verify\n      name: './verify-plugin.mjs'\n")
    // `headless` needs a job argument; every other profile is a server that
    // would reject an unknown positional. The verifier exits the process as
    // soon as its checks settle, so a server profile still terminates.
    const bootArgs = [...dsh, '--profile', options.profile, '--patch', join(profileDir, 'verify.patch.yml')]
    if (options.profile === 'headless') bootArgs.push('verify')
    const boot = run('npx', bootArgs, { env })
    const marker = /__PRODUCT_SUBAGENTS_VERIFY__(.*?)__END__/s.exec(boot.stdout)
    let runtime
    try { runtime = marker ? JSON.parse(marker[1]) : undefined } catch { runtime = undefined }
    if (!step('start', Boolean(runtime && runtime.ok), runtime ?? {
      exitCode: boot.code, tail: (boot.stderr || boot.stdout).trim().split('\n').slice(-5),
    })) return { version, ok: false, home, steps }

    // ── uninstall ─────────────────────────────────────────────────────────
    const remove = run('npx', [...dsh, 'plugin', '--profile', options.profile, 'remove', pkg.name], { env })
    const left = bundles(profileDir).includes(pkg.name)
    step('uninstall', remove.code === 0 && !left, {
      exitCode: remove.code, bundles: bundles(profileDir), tail: remove.stderr.trim().split('\n').slice(-3),
    })
    return { version, ok: steps.every((s) => s.ok), home, steps }
  } finally {
    if (!options.keep) rmSync(home, { recursive: true, force: true })
  }
}

const options = parseArgs(process.argv.slice(2))
const workspace = mkdtempSync(join(tmpdir(), 'dsh-verify-pack-'))
const tarball = packPlugin(workspace)
const results = []
for (const version of options.dsh) {
  process.stdout.write(`\n=== DSH ${version} ===\n`)
  const result = verifyRelease(version, options, tarball)
  for (const { step, ok, detail } of result.steps) {
    process.stdout.write(`  ${ok ? 'ok  ' : 'FAIL'} ${step.padEnd(10)} ${JSON.stringify(detail)}\n`)
  }
  process.stdout.write(`  => ${result.ok ? 'compatible' : 'FAILED'}${options.keep ? ` (profile kept at ${result.home})` : ''}\n`)
  results.push(result)
}
if (!options.keep) rmSync(workspace, { recursive: true, force: true })
if (options.json) writeFileSync(options.json, `${JSON.stringify(results, null, 2)}\n`)
process.exit(results.every((r) => r.ok) ? 0 : 1)
