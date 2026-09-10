/**
 * `ctx.subagents.listChildren()` returns a discriminated union: a `child` row
 * carries the durable identity (`activity`, `mode`, `label`, `hasChildren`),
 * while a `diagnostic` row carries only an id and a `reason` — the candidate's
 * descriptor was unreadable (`corrupt`) or transiently unavailable
 * (`unavailable`), so it has no activity, mode or label to report.
 *
 * Every consumer here wants the identity fields, so diagnostics are dropped
 * rather than surfaced as children with missing fields. Entries without a
 * `kind` are treated as children so an older harness listing still works.
 */

/** True for a listing row that carries a child's durable identity. */
export function isChildEntry(entry) {
  return Boolean(entry) && entry.kind !== 'diagnostic'
}

/** Only the identity-bearing rows of one `listChildren()` result. */
export function childEntries(list) {
  return Array.isArray(list) ? list.filter(isChildEntry) : []
}

/** The identity-bearing row for one child id, or undefined. */
export function findChildEntry(list, childId) {
  return childEntries(list).find((entry) => entry.id === childId)
}
