import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PERM_RANK } from '../lib/tools/product-delegate.js'

/**
 * The delegation permission ceiling: a child may not spawn a descendant with
 * a HIGHER permission rank. readonly(0) < default(1) < full(2). The root
 * (no binding) has no ceiling.
 */
function ceilingBlocked(callerMode, requestedMode, isChild) {
  if (!isChild) return false
  const callerRank = callerMode === undefined ? 1 : (PERM_RANK[callerMode] ?? 1)
  const requestedRank = PERM_RANK[requestedMode] ?? 1
  return requestedRank > callerRank
}

test('root (no binding) has no ceiling', () => {
  assert.equal(ceilingBlocked(undefined, 'full', false), false)
})

test('default child cannot spawn full', () => {
  assert.equal(ceilingBlocked(undefined, 'full', true), true)
  assert.equal(ceilingBlocked('default', 'full', true), true)
})

test('readonly child can only spawn readonly', () => {
  assert.equal(ceilingBlocked('readonly', 'full', true), true)
  assert.equal(ceilingBlocked('readonly', 'default', true), true)
  assert.equal(ceilingBlocked('readonly', 'readonly', true), false)
})

test('full child may spawn anything', () => {
  assert.equal(ceilingBlocked('full', 'full', true), false)
  assert.equal(ceilingBlocked('full', 'readonly', true), false)
  assert.equal(ceilingBlocked('full', 'default', true), false)
})
