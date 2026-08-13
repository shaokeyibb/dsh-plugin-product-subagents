import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Declarative role library: one JSON file per role (like Claude Code's
 * `.claude/agents/*.md`), loaded from `rolesDir` (default: this plugin's
 * `roles/` directory).
 *
 * Role schema:
 *   id             — stable identifier (file basename if omitted)
 *   description    — when to use this role (shown to the delegating model)
 *   provider       — product to delegate to ("" = caller chooses)
 *   permissionMode — "readonly" | "default" | "full" — applies to the REMOTE
 *                    PRODUCT agent, never to the relay model (the relay is
 *                    always a read-only pipe: only product_submit and, when
 *                    allowDelegation, product_delegate).
 *   allowDelegation— whether the subagent may spawn its own subagents
 *   instructions   — extra instructions prepended to the product's task
 *
 * Unknown roles fall back to `general`; a missing general role is an error.
 */
export function createRoleLibrary(rolesDir) {
  let cache

  const load = () => {
    if (cache !== undefined) return cache
    cache = {}
    try {
      for (const file of readdirSync(rolesDir)) {
        if (!file.endsWith('.json')) continue
        const id = file.slice(0, -'.json'.length)
        try {
          const raw = JSON.parse(readFileSync(join(rolesDir, file), 'utf8'))
          cache[id] = {
            id,
            description: raw.description || '',
            provider: raw.provider || '',
            permissionMode: ['readonly', 'default', 'full'].includes(raw.permissionMode) ? raw.permissionMode : 'default',
            // delegation defaults ON for standard roles (like Claude Code's
            // general-purpose agents); an explicit `false` bans it (e.g. the
            // Explore role, which must never spawn subagents)
            allowDelegation: raw.allowDelegation !== false,
            instructions: raw.instructions || '',
          }
        } catch {
          // a malformed role file is skipped (never breaks the plugin)
        }
      }
    } catch {
      // roles dir missing → only the built-in fallbacks below
    }
    // built-in fallback so a missing roles dir never breaks delegation
    if (!cache.general) {
      cache.general = {
        id: 'general',
        description: '通用代理:处理其他所有任务,放开产品全部权限。',
        provider: '',
        permissionMode: 'full',
        allowDelegation: true,
        instructions: 'You are the general-purpose agent. Complete the task directly and thoroughly with full permissions.',
      }
    }
    return cache
  }

  return {
    list() {
      return Object.values(load())
    },
    /** Resolve a role id; unknown ids fall back to `general`. */
    get(id) {
      const roles = load()
      return roles[id] || roles.general || null
    },
  }
}

export function defaultRolesDir() {
  // fileURLToPath (not `.pathname`): on Windows, `import.meta.url` pathname
  // starts with `/C:/…`, which join() would corrupt.
  return join(fileURLToPath(new URL('.', import.meta.url)), '..', 'roles')
}
