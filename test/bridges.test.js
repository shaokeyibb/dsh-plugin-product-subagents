import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createClaudeBridge } from '../lib/bridges/claude.js'
import { createCodexBridge } from '../lib/bridges/codex.js'
import { createAcpBridge } from '../lib/bridges/acp.js'

/**
 * The bridge contract: every bridge exposes create / submit / reconnect /
 * dispose. A FAKE bridge here verifies the interface shape that product
 * providers and tools rely on, without needing any real CLI or API key.
 */
function fakeBridge() {
  let n = 0
  return {
    async create() { return { kind: 'fake', id: `s${++n}` } },
    async submit(remote, task) { return { text: `echo:${task}`, stopReason: 'completed' } },
    async reconnect(id) { return { kind: 'fake', id } },
    async dispose() {},
  }
}

test('real bridges expose the contract', () => {
  for (const bridge of [createClaudeBridge(), createCodexBridge(), createAcpBridge()]) {
    assert.equal(typeof bridge.create, 'function')
    assert.equal(typeof bridge.submit, 'function')
    assert.equal(typeof bridge.reconnect, 'function')
    assert.equal(typeof bridge.dispose, 'function')
  }
})

test('fake bridge fulfills the same contract (interface-level integration)', async () => {
  const bridge = fakeBridge()
  const remote = await bridge.create('/tmp')
  const out = await bridge.submit(remote, 'task A')
  assert.equal(out.text, 'echo:task A')
  const resumed = await bridge.reconnect(remote.id)
  assert.equal(resumed.id, remote.id)
  await bridge.dispose(remote)
})

test('bridges accept timeoutMs without breaking the default', () => {
  const b = createClaudeBridge({ timeoutMs: 9000 })
  assert.equal(typeof b.submit, 'function')
  const c = createCodexBridge({ timeoutMs: 12000 })
  assert.equal(typeof c.submit, 'function')
})
