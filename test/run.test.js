import { test } from 'node:test'
import assert from 'node:assert/strict'
import { winArgs, cmdQuote, parentCwd } from '../lib/run.js'

test('winArgs quotes the command path', () => {
  const args = winArgs('C:\\Users\\x\\AppData\\Roaming\\npm\\claude.cmd', ['-p'])
  assert.equal(args[3], '"C:\\Users\\x\\AppData\\Roaming\\npm\\claude.cmd"')
})

test('winArgs quotes only args with spaces or cmd metacharacters', () => {
  const args = winArgs('claude.cmd', ['-p', '--model', 'claude-sonnet-5', 'Fix the bug in file & run the test'])
  assert.equal(args[4], '-p')
  assert.equal(args[6], 'claude-sonnet-5')
  assert.equal(args[7], '"Fix the bug in file & run the test"')
})

test('winArgs escapes embedded quotes in the task', () => {
  const args = winArgs('claude.cmd', ['say "hi" there'])
  assert.equal(args[4], '"say \\"hi\\" there"')
})

test('cmdQuote wraps and escapes', () => {
  assert.equal(cmdQuote('a b'), '"a b"')
  assert.equal(cmdQuote('a"b'), '"a\\"b"')
})

test('parentCwd falls back to process.cwd()', () => {
  assert.equal(parentCwd(null), process.cwd())
  assert.equal(parentCwd({}), process.cwd())
  assert.equal(parentCwd({ session: { header: { cwd: '/tmp/x' } } }), '/tmp/x')
})
