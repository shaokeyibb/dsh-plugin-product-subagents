import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerProductDelegate } from '../lib/tools/product-delegate.js'

function fixture(subagents) {
  let tool
  const ctx = { subagents, tools: { register: (definition) => { tool = definition } } }
  const role = {
    id: 'explore', permissionMode: 'readonly', allowDelegation: false,
    instructions: 'Inspect only.',
  }
  const state = { activeChildren: 0 }
  const pendingRelays = new Map()
  const bindings = new Map()
  const registry = new Map()
  registerProductDelegate(ctx, {
    bindings, pendingRelays, state,
    registry: { get: (id) => registry.get(id), remove: (id) => registry.delete(id) },
    availability: { codex: { registered: true } },
    providers: { codex: { type: 'codex' } },
    bridges: { codex: {} },
    roles: { list: () => [role], get: () => role },
    maxConcurrent: 1,
    availableProviders: ['codex'],
    runtimeName: (name) => `product-subagents:${name}`,
  })
  const exec = { agent: { session: { id: 'parent' } }, signal: new AbortController().signal }
  const run = () => tool.execute({ provider: 'codex', task: 'verify', model: 'chosen-model' }, exec)
  return { run, exec, state, pendingRelays, bindings, registry }
}

test('background delegation reserves a managed child and uses parent delivery', async () => {
  let settle
  const result = new Promise((resolve) => { settle = resolve })
  const runtime = {
    async startActivation(spec) {
      assert.equal(this, runtime)
      assert.equal(spec.parent, setup.exec.agent)
      assert.equal(spec.signal, setup.exec.signal)
      assert.equal(spec.provider, 'product-subagents:codex')
      assert.equal(spec.delivery, 'parent')
      assert.equal(spec.request, undefined)
      assert.deepEqual(spec.prompt, [{ type: 'text', text: 'Inspect only.\n\nverify' }])
      assert.deepEqual(setup.pendingRelays.get(spec.childId), {
        allowDelegation: false,
        settings: { permissionMode: 'readonly', model: 'chosen-model' },
      })
      return { childId: spec.childId, result }
    },
  }
  const setup = fixture(runtime)
  const started = await setup.run()
  assert.match(started.childId, /^[0-9a-f-]{36}$/)
  assert.equal(setup.pendingRelays.size, 0)
  await assert.rejects(setup.run(), /concurrency limit reached/)
  settle()
  await result
  assert.equal(setup.state.activeChildren, 0)
})

test('managed startup failure releases the slot and disposes its prepared binding', async () => {
  let disposed = 0
  const setup = fixture({
    async startActivation({ childId }) {
      setup.bindings.set(childId, { bridge: { dispose: async () => { disposed += 1 } } })
      setup.registry.set(childId, {})
      throw new Error('failed to publish')
    },
  })
  await assert.rejects(setup.run(), /failed to publish/)
  assert.equal(disposed, 1)
  assert.equal(setup.bindings.size, 0)
  assert.equal(setup.registry.size, 0)
  assert.equal(setup.pendingRelays.size, 0)
  assert.equal(setup.state.activeChildren, 0)
})

test('legacy background delegation still passes the nested request and tool allowlist', async () => {
  const setup = fixture({
    async startContinuable(spec) {
      assert.equal(spec.request.parent, setup.exec.agent)
      assert.deepEqual(spec.request.toolFilter, { allow: ['product_submit'] })
      assert.match(spec.request.persona, /relay bridge to the Codex CLI/)
      assert.equal(spec.delivery, undefined)
      return { childId: 'legacy-child' }
    },
  })
  assert.equal((await setup.run()).childId, 'legacy-child')
})
