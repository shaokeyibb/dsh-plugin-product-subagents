import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSyncProduct } from './run.js'

/**
 * Detect whether each product CLI exists and whether its login artifacts are
 * present. Missing command => the provider is NOT registered (and the
 * delegation tool omits it / errors clearly). Login artifacts are reported as
 * a hint; an actually broken credential (e.g. a 401) still surfaces at call
 * time with the product's own error.
 */
export function detectAvailability(products) {
  const result = {}
  for (const [name, def] of Object.entries(products)) {
    const found = commandExists(def.command)
    let auth = { ok: true, note: 'no auth required' }
    if (def.checkAuth) auth = def.checkAuth()
    result[name] = {
      registered: found,
      command: found,
      reason: found ? (auth.ok ? 'available' : `command present, but ${auth.note}`) : `command "${def.command}" not found on PATH`,
      auth,
    }
  }
  return result
}

function commandExists(command) {
  try {
    const result = spawnSyncProduct(command, ['--version'], { stdio: 'ignore', timeout: 10000 })
    if (result.error) return false
    return result.status === 0 || result.status === null
  } catch {
    return false
  }
}

const home = () => homedir()

export const authChecks = {
  'claude-code': () => {
    const candidates = [join(home(), '.claude', '.credentials.json'), join(home(), '.claude.json')]
    const present = candidates.some((p) => existsSync(p))
    return present
      ? { ok: true, note: 'login artifacts present' }
      : { ok: false, note: 'no Claude login artifacts found (~/.claude.json / ~/.claude/.credentials.json)' }
  },
  codex: () => {
    const path = join(home(), '.codex', 'auth.json')
    return existsSync(path)
      ? { ok: true, note: 'auth.json present (validity verified at call time)' }
      : { ok: false, note: '~/.codex/auth.json missing — run "codex login"' }
  },
  acp: () => ({ ok: true, note: 'no auth required' }),
}
