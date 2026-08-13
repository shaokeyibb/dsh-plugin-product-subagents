import { test } from 'node:test'
import assert from 'node:assert/strict'
import { foldProgress, foldTrace, foldTokenUsage } from '../lib/progress.js'

function events(list) {
  return list.map((e, i) => ({ seq: i + 1, ...e }))
}

test('foldProgress: turn/step/task/answer/marker', () => {
  const now = Date.now()
  const session = { events: events([
    { type: 'turn/start', timestamp: now - 60000, payload: { turn: 1 } },
    { type: 'step/start', timestamp: now - 59000, payload: { turn: 1, step: 1 } },
    { type: 'tool/call', timestamp: now - 58000, payload: { name: 'product_submit', args: { task: 'do thing A' } } },
    { type: 'assistant/message', timestamp: now - 50000, payload: { message: { content: [{ type: 'text', text: 'PROBE_CONT\nPRODUCT_SESSION:acp:sess-123' }] } } },
    { type: 'turn/end', timestamp: now - 49000, payload: { turn: 1 } },
    { type: 'turn/start', timestamp: now - 10000, payload: { turn: 2 } },
  ]) }
  const out = foldProgress(session)
  assert.equal(out.turn, 2)
  assert.equal(out.stepCount, 1)
  assert.equal(out.lastTask, 'do thing A')
  assert.match(out.lastAnswer, /PROBE_CONT/)
  assert.equal(out.product, 'acp')
  assert.equal(out.remoteSessionId, 'sess-123')
})

test('foldTrace: skips chunks, newest-last, bounded', () => {
  const now = Date.now()
  const session = { events: events([
    { type: 'assistant/chunk', timestamp: now, payload: { text: 'x' } },
    { type: 'assistant/chunk', timestamp: now, payload: { text: 'y' } },
    { type: 'tool/call', timestamp: now, payload: { name: 'product_submit', args: { task: 't' } } },
    { type: 'assistant/message', timestamp: now, payload: { message: { content: [{ type: 'text', text: 'answer' }] } } },
  ]) }
  const trace = foldTrace(session, 10)
  assert.equal(trace.length, 2)
  assert.equal(trace[0].event, 'tool/call')
  assert.match(trace[0].brief, /product_submit/)
  assert.equal(trace[1].event, 'assistant/message')
})

test('foldTokenUsage sums input/output/cache tokens', () => {
  const session = { events: events([
    { type: 'assistant/message', payload: { message: { usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100 } } } },
    { type: 'assistant/message', payload: { message: { usage: { input_tokens: 20, output_tokens: 7 } } } },
    { type: 'turn/start', payload: { turn: 1 } },
  ]) }
  const usage = foldTokenUsage(session)
  assert.deepEqual(usage, { inputTokens: 30, outputTokens: 12, cacheReadInputTokens: 100 })
})

test('foldProgress returns null for non-array events', () => {
  assert.equal(foldProgress(null), null)
  assert.equal(foldProgress({}), null)
  assert.deepEqual(foldTrace(undefined), [])
})
