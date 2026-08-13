import { recoverRemoteSessionId } from './bindings.js'

/**
 * Fold the tail of one child session's durable events into a compact progress
 * snapshot: last turn, step count, the latest product_submit task, the latest
 * answer text, last activity time, and the pinned product/remote session id
 * (from the PRODUCT_SESSION marker the bridge tool echoes in every result).
 * Schema-tolerant: unknown event shapes are skipped, never thrown on.
 */
export function foldProgress(session) {
  const events = session && session.events
  if (!Array.isArray(events)) return null
  const out = {
    turn: undefined,
    stepCount: 0,
    lastTask: undefined,
    lastAnswer: undefined,
    lastActivityAt: undefined,
  }
  const start = Math.max(0, events.length - 150)
  for (let i = start; i < events.length; i += 1) {
    const event = events[i]
    if (!event || typeof event.type !== 'string') continue
    const ts = event.timestamp ?? event.time ?? undefined
    const payload = (event && event.payload) || {}
    switch (event.type) {
      case 'turn/start': {
        if (typeof payload.turn === 'number') out.turn = payload.turn
        if (ts !== undefined) out.lastActivityAt = ts
        break
      }
      case 'turn/end': {
        if (ts !== undefined) out.lastActivityAt = ts
        break
      }
      case 'step/start': {
        out.stepCount += 1
        if (ts !== undefined) out.lastActivityAt = ts
        break
      }
      case 'assistant/message': {
        const text = messageText(payload)
        if (text) {
          out.lastAnswer = text.slice(0, 300)
          if (ts !== undefined) out.lastActivityAt = ts
        }
        break
      }
      case 'tool/call': {
        if (payload && payload.name === 'product_submit') {
          const task = extractString(payload, 'task')
          if (task) out.lastTask = task.slice(0, 300)
        }
        if (ts !== undefined) out.lastActivityAt = ts
        break
      }
      case 'tool/result': {
        const text = extractAnyText(payload)
        if (text) {
          out.lastAnswer = text.slice(0, 300)
          if (ts !== undefined) out.lastActivityAt = ts
        }
        break
      }
      default:
        break
    }
  }
  const marker = recoverRemoteSessionId(session)
  if (marker) {
    out.product = marker.product
    out.remoteSessionId = marker.sessionId
  }
  return out
}

/**
 * Fold the tail of a child session's durable events into a compact internal
 * trace: the most recent turn/step boundaries, tool calls (product_submit with
 * the submitted task), and relayed answers, newest last. `assistant/chunk`
 * stream events are skipped so the trace stays readable.
 */
export function foldTrace(session, max = 12) {
  const events = session && session.events
  if (!Array.isArray(events)) return []
  const trace = []
  for (let i = events.length - 1; i >= 0 && trace.length < max; i -= 1) {
    const event = events[i]
    if (!event || typeof event.type !== 'string') continue
    if (event.type === 'assistant/chunk') continue
    trace.unshift(compactEvent(event))
  }
  return trace
}

function compactEvent(event) {
  const timestamp = event.timestamp ?? event.time
  const payload = (event && event.payload) || {}
  let brief
  switch (event.type) {
    case 'turn/start':
      brief = `turn ${payload.turn} start`
      break
    case 'turn/end':
      brief = `turn ${payload.turn} end`
      break
    case 'step/start':
      brief = `step ${payload.turn}.${payload.step}`
      break
    case 'tool/call': {
      if (payload.name === 'product_submit' && payload.args && typeof payload.args.task === 'string') {
        brief = `product_submit: ${payload.args.task.slice(0, 80)}`
      } else {
        brief = `tool ${payload.name || '?'}`
      }
      break
    }
    case 'assistant/message': {
      const text = messageText(payload)
      brief = text ? `answer: ${text.slice(0, 120)}` : 'assistant message'
      break
    }
    default:
      brief = event.type
  }
  return { at: timestamp !== undefined ? new Date(timestamp).toISOString() : undefined, event: event.type, brief }
}

/** Best-effort token usage fold from assistant/message payloads. */
export function foldTokenUsage(session) {
  const events = session && session.events
  if (!Array.isArray(events)) return undefined
  let input = 0
  let output = 0
  let cacheRead = 0
  const start = Math.max(0, events.length - 150)
  for (let i = start; i < events.length; i += 1) {
    const event = events[i]
    if (!event || event.type !== 'assistant/message') continue
    const payload = (event.payload) || {}
    const message = payload.message || payload
    const usage = message.usage || payload.usage
    if (!usage || typeof usage !== 'object') continue
    if (typeof usage.input_tokens === 'number') input += usage.input_tokens
    if (typeof usage.output_tokens === 'number') output += usage.output_tokens
    if (typeof usage.cache_read_input_tokens === 'number') cacheRead += usage.cache_read_input_tokens
  }
  if (input === 0 && output === 0 && cacheRead === 0) return undefined
  return { inputTokens: input, outputTokens: output, cacheReadInputTokens: cacheRead }
}

function messageText(payload) {
  const message = (payload && payload.message) || payload
  const content = message && message.content
  if (!Array.isArray(content)) return undefined
  const text = content
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n')
  return text || undefined
}

function extractString(value, key) {
  if (!value || typeof value !== 'object') return undefined
  if (typeof value[key] === 'string') return value[key]
  for (const k of Object.keys(value)) {
    const v = value[k]
    if (v && typeof v === 'object') {
      const result = extractString(v, key)
      if (result) return result
    }
  }
  return undefined
}

function extractAnyText(value) {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return undefined
  for (const k of Object.keys(value)) {
    const v = value[k]
    if (typeof v === 'string' && v.length > 4) return v
    if (v && typeof v === 'object') {
      const result = extractAnyText(v)
      if (result) return result
    }
  }
  return undefined
}
