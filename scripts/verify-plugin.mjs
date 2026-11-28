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
import assert from 'node:assert/strict'

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

/** Exercise managed startup and settlement without calling a live model or product CLI. */
async function verifyBackgroundDelegate(ctx) {
  const { LlmAdapter } = await import('@deepseek-ai/dsh-llm')
  let turns = 0
  class VerifyAdapter extends LlmAdapter {
    async *stream() {
      const block = { type: 'text', text: ++turns === 1 ? 'PRODUCT_OK' : 'CONTINUED_OK' }
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: block.text }
      yield { type: 'block-end', index: 0, block }
      yield { type: 'finish', reason: 'stop' }
    }
  }
  ctx.get('llm').registerAdapter(['product-verifier'], new VerifyAdapter())
  const signal = AbortSignal.timeout(10000)
  const handle = await ctx.get('agents').create({
    meta: { cwd: process.cwd() },
    agentOptions: { provider: 'product-verifier', model: 'test-model' },
    signal,
  })
  const scopes = new Map()
  const off = ctx.on('agent/created', ({ agent }) => {
    const visible = agent.ctx.tools.definitions(agent).map((tool) => tool.name)
    scopes.set(agent.id, visible.sort())
  })
  const execute = (name, args) => ctx.tools.get(name).execute(args, { agent: handle.agent, signal })
  try {
    const result = await execute('product_delegate', { provider: 'codex', role: 'explore', task: 'verify', background: true })
    assert.ok(typeof result.childId === 'string' && result.childId.length > 0)
    assert.deepEqual(scopes.get(result.childId), ['product_submit'])
    const { children } = await execute('product_agents', {})
    assert.ok(children.some(({ id, mode }) => id === result.childId && mode === 'continuable'))
    const done = await execute('product_wait', { subagent_id: result.childId, timeout_ms: 5000 })
    assert.ok(['ready', 'completed'].includes(done.status), JSON.stringify(done))
    assert.equal(done.answer, 'PRODUCT_OK')
    const progress = await execute('subagent_progress', { subagent_id: result.childId })
    assert.equal(progress.mode, 'continuable')
    assert.equal((await execute('subagent_progress', { subagent_id: 'missing' })).status, 'unknown')
    // Wait for disposal so the resumed relay gets its policy from the registry.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const { children: settled } = await execute('product_agents', {})
      if (settled.some(({ id, pinned }) => id === result.childId && !pinned)) break
      if (attempt === 19) throw new Error('the idle product binding was not disposed')
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    scopes.delete(result.childId)
    await ctx.subagents.sendMessage(handle.agent, result.childId, [{ type: 'text', text: 'continue' }], { signal })
    const resumed = await execute('product_wait', { subagent_id: result.childId, timeout_ms: 5000 })
    assert.equal(resumed.answer, 'CONTINUED_OK', JSON.stringify(resumed))
    assert.deepEqual(scopes.get(result.childId), ['product_submit'])
    return { mode: 'continuable', allowed: scopes.get(result.childId), answer: done.answer, resumed: resumed.answer }
  } finally {
    off()
    await handle.dispose()
  }
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

    if (typeof ctx.subagents.startActivation === 'function' && enumerated?.includes('codex')) {
      try {
        add('product_delegate background', true, await verifyBackgroundDelegate(ctx))
      } catch (error) {
        add('product_delegate background', false, String(error.stack || error))
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
