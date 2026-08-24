import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stripUndefined } from '../lib/lossless.js'

test('stripUndefined drops undefined-valued keys', () => {
  const out = stripUndefined({ a: 1, b: undefined, c: 'x' })
  assert.deepEqual(out, { a: 1, c: 'x' })
  assert.ok(!('b' in out))
})

test('stripUndefined recurses into nested objects', () => {
  const out = stripUndefined({ a: { b: undefined, c: { d: undefined, e: 2 } } })
  assert.deepEqual(out, { a: { c: { e: 2 } } })
})

test('stripUndefined recurses into arrays', () => {
  const out = stripUndefined([{ a: undefined, b: 1 }, { c: 2 }])
  assert.deepEqual(out, [{ b: 1 }, { c: 2 }])
})

test('stripUndefined preserves falsy-but-defined values', () => {
  const out = stripUndefined({ zero: 0, empty: '', no: false, nul: null })
  assert.deepEqual(out, { zero: 0, empty: '', no: false, nul: null })
})

test('result of stripUndefined is lossless JSON (round-trips unchanged)', () => {
  // A progress-tool-shaped result with the fields that are undefined whenever a
  // claude child has no local session/fold — the exact case that threw
  // "value is not lossless JSON" on every poll before the fix.
  const raw = {
    childId: 'abc',
    status: 'running',
    mode: undefined,
    label: undefined,
    pinnedProduct: 'claude-code',
    turn: undefined,
    stepCount: 0,
    lastTask: undefined,
    lastAnswer: undefined,
    trace: undefined,
    inFlight: undefined,
  }
  const clean = stripUndefined(raw)
  assert.deepEqual(JSON.parse(JSON.stringify(clean)), clean)
  for (const [, v] of Object.entries(clean)) assert.notEqual(v, undefined)
  assert.deepEqual(clean, { childId: 'abc', status: 'running', pinnedProduct: 'claude-code', stepCount: 0 })
})

test('stripUndefined passes non-plain values through untouched', () => {
  const d = new Date(0)
  assert.equal(stripUndefined(d), d)
  assert.equal(stripUndefined('s'), 's')
  assert.equal(stripUndefined(5), 5)
  assert.equal(stripUndefined(null), null)
})
