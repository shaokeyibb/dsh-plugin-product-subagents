import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateConfig } from '../lib/config.js'

test('valid configs pass', () => {
  assert.deepEqual(validateConfig({}), {})
  assert.equal(validateConfig({ idleTimeoutMs: 600000 }).idleTimeoutMs, 600000)
  assert.equal(validateConfig({ maxConcurrentChildren: 3 }).maxConcurrentChildren, 3)
  const cfg = validateConfig({
    providers: { cursor: { type: 'acp', command: 'agent', args: ['acp'] } },
    idleTimeoutMs: 0,
  })
  assert.equal(cfg.providers.cursor.command, 'agent')
})

test('invalid config fails loudly with a precise message', () => {
  assert.throws(() => validateConfig({ idleTimeoutMs: -5 }), /idleTimeoutMs/)
  assert.throws(() => validateConfig({ maxConcurrentChildren: 0 }), /maxConcurrentChildren/)
  assert.throws(() => validateConfig({ providers: { x: { type: 'banana' } } }), /providers\.x\.type/)
  assert.throws(() => validateConfig({ providers: { x: { command: '' } } }), /providers\.x\.command/)
})
