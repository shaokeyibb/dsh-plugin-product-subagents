/**
 * The in-profile verifier loaded by `scripts/verify-dsh-profile.mjs` as a
 * `--patch` overlay: it boots INSIDE a real DSH profile, after every bundle
 * layer (including this plugin's own), and reports what the running harness
 * actually did with the plugin.
 *
 * It is not part of `npm test` — that suite must stay credential-free and
 * CLI-free. This file only ever runs inside a disposable profile.
 */
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'

export const name = 'product-subagents-verify'
export const inject = ['tools', 'subagents']

/** Every tool `lib/index.js` registers. */
const TOOLS = [
  'product_delegate', 'product_roles', 'product_submit',
  'subagent_progress', 'product_wait', 'product_agents',
]

/** A minimal caller identity for the two tools that need no live agent. */
const stubExec = {
  signal: new AbortController().signal,
  agent: { session: { id: 'verify-root-session', header: { cwd: process.cwd() } } },
}

/** Paths of every `undefined` reachable in a value — what the harness rejects. */
function undefinedPaths(value, path = '$', out = []) {
  if (value === undefined) { out.push(path); return out }
  if (Array.isArray(value)) { value.forEach((e, i) => undefinedPaths(e, `${path}[${i}]`, out)); return out }
  if (value && typeof value === 'object') {
    for (const [key, val] of Object.entries(value)) undefinedPaths(val, `${path}.${key}`, out)
  }
  return out
}

export function apply(ctx) {
  const report = { dsh: process.env.DSH_VERIFY_VERSION || 'unknown', ok: false, checks: [] }
  const add = (check, ok, detail) => report.checks.push({ check, ok, detail })
  const emit = () => {
    process.stdout.write(`\n__PRODUCT_SUBAGENTS_VERIFY__${JSON.stringify(report)}__END__\n`)
    process.exit(report.ok ? 0 : 1)
  }

  const run = async () => {
    // This fiber shares the plugin's injects, so both become active in the same
    // pass; wait (bounded) for the plugin's registrations to land.
    for (let i = 0; i < 100 && !ctx.tools.get('product_agents'); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    const found = TOOLS.filter((tool) => Boolean(ctx.tools.get(tool)))
    add('tools registered', found.length === TOOLS.length, {
      found, missing: TOOLS.filter((tool) => !found.includes(tool)),
    })

    // Providers registered on the real SubagentRuntime, and the delegate tool's
    // own provider enum — the two must agree.
    let registered = []
    try {
      registered = [...(ctx.subagents.providers ? ctx.subagents.providers.keys() : [])]
    } catch { registered = [] }
    const ours = registered.filter((id) => id.startsWith('product-subagents:'))
    const delegate = ctx.tools.get('product_delegate')
    const properties = delegate && delegate.parameters ? delegate.parameters.properties : undefined
    const enumerated = properties && properties.provider ? properties.provider.enum : undefined
    // `providers` is the runtime's own map; treat it as best-effort evidence and
    // fall back to the delegate tool's enum, which the plugin builds from the
    // very providers it registered.
    add('subagent providers registered',
      registered.length > 0 || (Array.isArray(enumerated) && enumerated.length > 0),
      { registered, ours, delegateProviderEnum: enumerated })

    // Registrations must be additive plugin-owned ids: a bare `claude-code` /
    // `codex` / `acp` from THIS plugin would collide with the official
    // `@deepseek-ai/dsh-subagent-*` providers and fail the whole plugin tree.
    if (ours.length > 0 && Array.isArray(enumerated)) {
      const missing = enumerated.filter((key) => !ours.includes(`product-subagents:${key}`))
      add('provider ids are plugin-owned', missing.length === 0, { ours, missing })
    }

    // Execute the two tools that need no live child, and hold their results to
    // the same contract the harness enforces: declared output schema + strict
    // lossless JSON (no `undefined` anywhere).
    for (const tool of ['product_roles', 'product_agents']) {
      const definition = ctx.tools.get(tool)
      if (!definition) { add(`${tool} execute`, false, 'not registered'); continue }
      try {
        const value = await definition.execute({}, stubExec)
        const undef = undefinedPaths(value)
        validateJsonSchemaValue(definition.output.schema, value)
        const rendered = definition.output.render({}, value)
        add(`${tool} execute`, undef.length === 0 && rendered.length > 0, {
          undefinedAt: undef,
          keys: Object.keys(value),
          renderedBlocks: rendered.length,
        })
      } catch (error) {
        add(`${tool} execute`, false, String((error && error.message) || error))
      }
    }

    report.ok = report.checks.every((check) => check.ok)
    emit()
  }

  run().catch((error) => {
    report.ok = false
    report.fatal = String((error && error.stack) || error)
    emit()
  })
}
