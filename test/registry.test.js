import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { createRegistry } from '../lib/registry.js'

test('registry round-trips set/get/remove', () => {
  const path = join(tmpdir(), `reg-test-${Date.now()}.json`)
  try {
    const reg = createRegistry(path)
    assert.equal(reg.get('child-1'), undefined)
    reg.set('child-1', { product: 'acp', remoteId: 'ses_123', cwd: '/tmp' })
    const got = reg.get('child-1')
    assert.equal(got.product, 'acp')
    assert.equal(got.remoteId, 'ses_123')
    assert.equal(typeof got.updatedAt, 'number')
    reg.remove('child-1')
    assert.equal(reg.get('child-1'), undefined)
    assert.ok(existsSync(path), 'registry file persisted')
  } finally {
    rmSync(path, { force: true })
    rmSync(`${path}.tmp`, { force: true })
  }
})

test('registry reloads from disk across instances', () => {
  const path = join(tmpdir(), `reg-test2-${Date.now()}.json`)
  try {
    const reg = createRegistry(path)
    reg.set('child-9', { product: 'codex', remoteId: 'thread-1', cwd: '/tmp' })
    const reg2 = createRegistry(path)
    assert.equal(reg2.get('child-9').remoteId, 'thread-1')
    // atomic write means no stray .tmp
    assert.equal(existsSync(`${path}.tmp`), false)
  } finally {
    rmSync(path, { force: true })
    rmSync(`${path}.tmp`, { force: true })
  }
})
