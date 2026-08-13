import { homedir } from 'node:os'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Durable registry mapping a product child's harness session id to its remote
 * product session id. The remote id is captured the moment it is known and
 * survives binding disposal (idle release) and process restarts, so a cold
 * resumed child reconnects to the SAME product session instead of resetting
 * the conversation (the child's own log cannot carry it reliably: tool-result
 * payloads are empty in the durable log and the relay model may strip the
 * marker line).
 *
 * Writes are small and atomic (temp file + rename). Stale entries (a deleted
 * child) are harmless: reconnection falls back to a fresh product session.
 */
const DEFAULT_PATH = join(homedir(), '.dsh', 'product-subagents-registry.json')

export function createRegistry(path = DEFAULT_PATH) {
  let cache

  const load = () => {
    if (cache !== undefined) return cache
    try {
      const raw = readFileSync(path, 'utf8')
      cache = JSON.parse(raw)
    } catch {
      cache = {}
    }
    return cache
  }

  const save = () => {
    try {
      mkdirSync(dirname(path), { recursive: true })
      const tmp = `${path}.tmp`
      writeFileSync(tmp, JSON.stringify(cache, null, 2))
      renameSync(tmp, path)
    } catch {
      // best-effort: recovery falls back to the session-log scan
    }
  }

  return {
    /** Record or refresh one child's remote session identity. */
    set(childId, entry) {
      const data = load()
      data[childId] = { ...entry, updatedAt: Date.now() }
      save()
    },
    /** Look up one child's recorded remote session identity. */
    get(childId) {
      const data = load()
      return data[childId]
    },
    /** Drop one child's entry (e.g. when its session is deleted). */
    remove(childId) {
      const data = load()
      if (data[childId] !== undefined) {
        delete data[childId]
        save()
      }
    },
  }
}
