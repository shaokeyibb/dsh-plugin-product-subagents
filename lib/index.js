import { bindings, MARKER, recoverRemoteSessionId } from './bindings.js'
import { detectAvailability } from './availability.js'
import { validateConfig } from './config.js'
import { foldProgress, foldTrace, foldTokenUsage } from './progress.js'
import { buildProviders, createBridgeFor } from './providers.js'
import { createRegistry } from './registry.js'
import { createRoleLibrary, defaultRolesDir } from './roles.js'
import { parentCwd } from './run.js'
import { registerProductSubmit } from './tools/product-submit.js'
import { registerProductDelegate } from './tools/product-delegate.js'
import { registerProductRoles } from './tools/product-roles.js'
import { registerSubagentProgress } from './tools/subagent-progress.js'
import { registerProductWait } from './tools/product-wait.js'
import { registerProductAgents } from './tools/product-agents.js'

export const name = 'product-subagents'
export const inject = ['subagents', 'tools', 'sessions']

/**
 * Role-based Codex / Claude Code / ACP subagent providers for the DeepSeek
 * Harness.
 *
 * Providers come from a config-driven registry (built-ins plus custom
 * `config.providers`, see lib/providers.js) and are registered ONLY for
 * products whose CLI was detected on PATH. Each provider supports both
 * one-shot `start()` and `prepareContinuable()`. Continuable children are
 * pinned to one product and one remote session for their lifetime: the
 * binding is keyed by the child session id, created once, and never switches
 * products (recovery reads the child's own log and the durable registry, so
 * even recovery cannot cross products).
 *
 * Tools registered (each in lib/tools/):
 *  - `product_delegate` — role-aware delegation (sync one-shot or async
 *    continuable), with optional model / reasoning-effort overrides.
 *  - `product_roles` — the declarative role library.
 *  - `product_submit` — the per-child bridge tool (children only).
 *  - `subagent_progress` — latest progress of one product subagent.
 *  - `product_wait` — attach to a child and block until it settles.
 *  - `product_agents` — detected availability + live children overview.
 */
export function apply(ctx, config = {}) {
  const cfg = validateConfig(config)
  const providers = buildProviders(cfg)
  const availability = detectAvailability(providers)
  const bridges = Object.fromEntries(
    Object.entries(providers)
      .filter(([name]) => availability[name].registered)
      .map(([name, def]) => [name, createBridgeFor(def)]),
  )
  // Durable remote-session registry: survives binding disposal and restarts so
  // a cold-resumed child reconnects to the same product session.
  const registry = createRegistry(cfg.registryPath)

  /** Persist the child's currently-known remote session id, if any. */
  const persistRemote = (childId, record, cwd) => {
    const remoteId = record && record.remote && (record.remote.sessionId || record.remote.threadId)
    if (!remoteId) return
    registry.set(childId, { product: record.product, remoteId, cwd })
  }

  // Idle disposal: a settled child's remote session (a persistent ACP server
  // process, or a resumable claude/codex id) is disposed after it stays
  // unreused for `idleTimeoutMs`. 0 disables auto-disposal. Reuse (a
  // product_submit call) cancels the pending timer, so fast continuation
  // (send_message cold resume) never pays a reconnect; long-idle children
  // release their processes instead of leaking until plugin unload.
  const idleTimeoutMs = cfg.idleTimeoutMs !== undefined ? Math.max(0, Number(cfg.idleTimeoutMs) || 0) : 600000
  const disposeTimers = new Map()
  const cancelDispose = (childId) => {
    const timer = disposeTimers.get(childId)
    if (timer !== undefined) {
      clearTimeout(timer)
      disposeTimers.delete(childId)
    }
  }
  const scheduleDispose = (childId) => {
    cancelDispose(childId)
    if (idleTimeoutMs <= 0) return
    const timer = setTimeout(() => {
      disposeTimers.delete(childId)
      const record = bindings.get(childId)
      if (record) {
        record.bridge.dispose(record.remote).catch(() => {})
        bindings.delete(childId)
      }
    }, idleTimeoutMs)
    disposeTimers.set(childId, timer)
  }

  let seq = 0

  const taskText = (request) => {
    const prompt = request && request.prompt
    if (!Array.isArray(prompt)) return ''
    return prompt.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n')
  }

  // ── providers (only for detected, registered products) ────────────────────
  for (const [providerName, bridge] of Object.entries(bridges)) {
    const provider = {
      name: providerName,
      inheritsParentContext: false,
      // The harness rejects persona/toolFilter requests unless the provider
      // advertises the capability. For continuable children the manager
      // applies both itself (applyChildComposition); for one-shot remote
      // children they are trivially satisfied (no child tool surface).
      capabilities: { persona: true, toolFilter: true },
      async start(request) {
        const cwd = parentCwd(request.parent)
        const task = taskText(request)
        const remote = await bridge.create(cwd)
        try {
          const out = await bridge.submit(remote, task, request.signal, cwd, request.productSettings)
          const id = `${providerName}-${Date.now().toString(36)}-${++seq}`
          return {
            id,
            localAgent: undefined,
            result: Promise.resolve({
              output: [{ type: 'text', text: out.text }],
              stopReason: out.stopReason,
            }),
            async dispose() {
              await bridge.dispose(remote).catch(() => {})
            },
          }
        } catch (error) {
          await bridge.dispose(remote).catch(() => {})
          throw error
        }
      },
      async prepareContinuable(request) {
        const cwd = parentCwd(request.parent)
        const remote = await bridge.create(cwd)
        bindings.set(request.sessionId, { product: providerName, bridge, remote, settings: undefined })
        // acp learns its session id at creation; claude/codex persist it after
        // the first submission via product_submit.
        persistRemote(request.sessionId, { product: providerName, remote }, cwd)
        return { seed: [] }
      },
    }
    ctx.subagents.registerProvider(provider)
  }

  // ── shared tool dependencies ────────────────────────────────────────────────
  const roles = createRoleLibrary(cfg.rolesDir || defaultRolesDir())
  const availableProviders = Object.keys(bridges)
  const state = { activeChildren: 0 }
  const maxConcurrent = Math.max(1, Number(cfg.maxConcurrentChildren) || 8)
  const deps = {
    bindings, MARKER, recoverRemoteSessionId,
    bridges, availability, providers, roles,
    registry, persistRemote, cancelDispose,
    foldProgress, foldTrace, foldTokenUsage,
    state, maxConcurrent, availableProviders,
  }

  registerProductSubmit(ctx, deps)
  registerProductDelegate(ctx, deps)
  registerProductRoles(ctx, deps)
  registerSubagentProgress(ctx, deps)
  registerProductWait(ctx, deps)
  registerProductAgents(ctx, deps)

  // ── idle disposal: settle → schedule release (reuse cancels it) ────────────
  // The event is emitted per continuable Activation epoch, i.e. after every
  // completed turn of a leaf child. Scheduling (not immediate) disposal keeps
  // fast send_message continuation on the same remote session, while children
  // that stay idle for `idleTimeoutMs` release their processes/sessions.
  ctx.on('subagent/end', (info) => {
    if (info && info.id) {
      if (bindings.has(info.id)) scheduleDispose(info.id)
      state.activeChildren = Math.max(0, state.activeChildren - 1)
    }
  })

  // ── plugin teardown: dispose every live remote session ─────────────────────
  ctx.effect(() => {
    return () => {
      for (const timer of disposeTimers.values()) clearTimeout(timer)
      disposeTimers.clear()
      for (const record of bindings.values()) {
        record.bridge.dispose(record.remote).catch(() => {})
      }
      bindings.clear()
    }
  })
}
