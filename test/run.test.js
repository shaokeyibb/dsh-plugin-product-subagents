import { test } from 'node:test'
import assert from 'node:assert/strict'
import { winArgs, cmdQuote, parentCwd } from '../lib/run.js'

test('winArgs wraps the whole invocation in one outer pair of quotes', () => {
  const args = winArgs('claude.cmd', ['-p'])
  assert.equal(args[3], '""claude.cmd" -p"')
})

test('winArgs quotes the command path', () => {
  const args = winArgs('C:\\Users\\x\\AppData\\Roaming\\npm\\claude.cmd', ['-p'])
  assert.equal(args[3], '""C:\\Users\\x\\AppData\\Roaming\\npm\\claude.cmd" -p"')
})

test('winArgs quotes only args with spaces or cmd metacharacters', () => {
  const args = winArgs('claude.cmd', ['-p', '--model', 'claude-sonnet-5', 'Fix the bug in file & run the test'])
  assert.equal(args[3], '""claude.cmd" -p --model claude-sonnet-5 "Fix the bug in file & run the test""')
})

test('winArgs escapes embedded quotes in the task', () => {
  const args = winArgs('claude.cmd', ['say "hi" there'])
  assert.equal(args[3], '""claude.cmd" "say \\"hi\\" there""')
})

test('cmd /S /C strips exactly the outer quote pair, leaving the command name intact', () => {
  const args = winArgs('claude.cmd', ['-p', '--output-format', 'json', 'You are an agent. 读取 C:\\Users\\X\\.codex\\AGENTS.md'])
  // cmd /S /C rule: first char is a quote → strip it and the last quote char.
  // The bug fixed in #1: a bare `"claude.cmd"` prefix made the command token
  // `claude.cmd"` → "'claude\" ...' is not recognized".
  const stripped = args[3].slice(1, -1)
  assert.equal(stripped, '"claude.cmd" -p --output-format json "You are an agent. 读取 C:\\Users\\X\\.codex\\AGENTS.md"')
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
