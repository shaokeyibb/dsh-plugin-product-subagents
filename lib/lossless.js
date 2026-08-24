/**
 * Recursively drop `undefined`-valued keys and array elements so a value is
 * lossless JSON.
 *
 * The harness validates every tool result as strict lossless JSON: an
 * `undefined` value anywhere in the returned object throws
 * `value is not lossless JSON` and the tool call fails. The progress/wait tools
 * build their result from optional fold fields (turn, lastTask, trace, inFlight,
 * stopReason, ...) that are legitimately `undefined` whenever a child has no
 * local session snapshot — e.g. an active `claude` product child, whose events
 * live in the remote CLI, not in a dsh session. Passing such a result through
 * this helper strips those keys instead of failing the poll.
 *
 * Non-plain values (Date, etc.) are returned as-is; callers pre-serialize those
 * to strings before returning.
 */
export function stripUndefined(value) {
  if (Array.isArray(value)) return value.map(stripUndefined)
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out = {}
    for (const [key, val] of Object.entries(value)) {
      if (val === undefined) continue
      out[key] = stripUndefined(val)
    }
    return out
  }
  return value
}
