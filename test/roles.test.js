import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRoleLibrary } from '../lib/roles.js'

function makeRolesDir(files) {
  const dir = mkdtempSync(join(tmpdir(), 'roles-'))
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), typeof content === 'string' ? content : JSON.stringify(content))
  }
  return dir
}

test('loads roles with delegation default ON and explicit false', () => {
  const dir = makeRolesDir({
    'a.json': { description: 'A', permissionMode: 'readonly' },
    'b.json': { description: 'B', allowDelegation: false },
    'c.json': { description: 'C', allowDelegation: true, permissionMode: 'full' },
  })
  try {
    const lib = createRoleLibrary(dir)
    const roles = lib.list()
    // a + b + c + the built-in general fallback (the test dir has no general)
    assert.equal(roles.length, 4)
    const byId = Object.fromEntries(roles.map((r) => [r.id, r]))
    assert.equal(byId.a.allowDelegation, true, 'unspecified delegation defaults to true')
    assert.equal(byId.b.allowDelegation, false, 'explicit false bans delegation')
    assert.equal(byId.c.allowDelegation, true)
    assert.equal(byId.a.permissionMode, 'readonly')
    assert.equal(byId.c.permissionMode, 'full')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('invalid permissionMode falls back to default', () => {
  const dir = makeRolesDir({ 'x.json': { description: 'X', permissionMode: 'banana' } })
  try {
    const lib = createRoleLibrary(dir)
    assert.equal(lib.get('x').permissionMode, 'default')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('unknown role falls back to general; missing library gets built-in general', () => {
  const dir = makeRolesDir({})
  try {
    const lib = createRoleLibrary(dir)
    assert.equal(lib.get('nope').id, 'general')
    assert.equal(lib.get('general').permissionMode, 'full')
    assert.equal(lib.get('general').allowDelegation, true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('malformed role files are skipped without breaking the library', () => {
  const dir = makeRolesDir({
    'good.json': { description: 'good' },
    'bad.json': 'not json',
  })
  try {
    const lib = createRoleLibrary(dir)
    assert.equal(lib.get('good').id, 'good')
    assert.ok(!lib.list().some((r) => r.id === 'bad'), 'malformed role is not loaded')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
