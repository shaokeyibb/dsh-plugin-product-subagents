import { test } from 'node:test'
import assert from 'node:assert/strict'
import { childEntries, findChildEntry, isChildEntry } from '../lib/children.js'

/**
 * `listChildren()` returns a union: identity-bearing `child` rows and
 * `diagnostic` rows that carry only an id and a reason. Every consumer here
 * wants the identity fields, so diagnostics must not reach them.
 */
const CHILD = { kind: 'child', id: 'a', activity: 'running', mode: 'continuable', label: 'x', hasChildren: false }
const DIAGNOSTIC = { kind: 'diagnostic', id: 'b', reason: 'corrupt' }

test('diagnostic rows are not children', () => {
  assert.equal(isChildEntry(CHILD), true)
  assert.equal(isChildEntry(DIAGNOSTIC), false)
  assert.equal(isChildEntry(undefined), false)
})

test('childEntries drops diagnostics and keeps order', () => {
  assert.deepEqual(childEntries([CHILD, DIAGNOSTIC, { ...CHILD, id: 'c' }]).map((e) => e.id), ['a', 'c'])
})

test('childEntries tolerates a non-array listing', () => {
  assert.deepEqual(childEntries(undefined), [])
  assert.deepEqual(childEntries(null), [])
})

test('an entry without a kind is treated as a child (older harness listing)', () => {
  const legacy = { id: 'z', activity: 'inactive', mode: 'one-shot' }
  assert.deepEqual(childEntries([legacy]), [legacy])
})

test('findChildEntry never returns a diagnostic for a matching id', () => {
  assert.equal(findChildEntry([CHILD, DIAGNOSTIC], 'a'), CHILD)
  assert.equal(findChildEntry([CHILD, DIAGNOSTIC], 'b'), undefined)
  assert.equal(findChildEntry([CHILD], 'missing'), undefined)
})
