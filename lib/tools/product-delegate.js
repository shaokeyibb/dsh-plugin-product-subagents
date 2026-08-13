import { defineTool } from '@deepseek-ai/dsh-tools'
import { providerPersona } from '../providers.js'
import { parentCwd } from '../run.js'

/** Permission ordering for the delegation ceiling. */
export const PERM_RANK = { readonly: 0, default: 1, full: 2 }

/**
 * The delegation tool: role-aware sync one-shot or async continuable. The
 * role decides the REMOTE product's permissions, whether the child may
 * delegate, and its extra instructions; the relay model stays a read-only
 * pipe in every case. Delegation enforces a permission ceiling: a product
 * child may never spawn a descendant with more permission than it has.
 */
export function registerProductDelegate(ctx, deps) {
  const {
    bindings, bridges, availability, providers, roles,
    state, maxConcurrent, availableProviders,
  } = deps
  const roleIds = roles.list().map((r) => r.id)

  ctx.tools.register(defineTool({
    name: 'product_delegate',
    description: 'Delegate task work to a configured product CLI (Claude Code / Codex / any ACP agent) under a declared role. background=true (default) starts a durable continuable child — control it with send_message / list_agents / interrupt_agent / subagent_progress, and it can be resumed with more context after settling. background=false runs one-shot synchronously and returns the final answer now. The chosen product and its remote session are pinned for the child\'s lifetime. The role decides the REMOTE product\'s permissions (readonly/default/full), whether the child may spawn its own subagents, and its extra instructions; the relay model stays a read-only pipe in every case.',
    parameters: {
      role: {
        type: 'string',
        enum: roleIds.length ? roleIds : ['general'],
        description: 'Role from the declarative role library (product_roles lists them). Defaults to "general" (full product permissions, may delegate).',
      },
      provider: {
        type: 'string',
        enum: availableProviders.length ? availableProviders : ['codex', 'claude-code', 'acp'],
        description: 'Product CLI to use. Defaults to the role\'s provider; required when the role does not pin one (only detected agents are registered).',
      },
      task: { type: 'string', required: true, description: 'The task text for the product agent.' },
      model: { type: 'string', description: 'Product model override. Omit to inherit the product\'s own default model configuration (claude-code: --model, codex: -c model=). ACP uses the agent\'s own configuration.' },
      reasoning_effort: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Product reasoning effort. Omit to inherit the product\'s own default (claude-code: --effort, codex: -c model_reasoning_effort=). ACP uses the agent\'s own configuration.' },
      background: { type: 'boolean', default: true, description: 'false = run one-shot synchronously and return the final answer now.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          childId: { type: 'string', description: 'continuable child session id (background mode).' },
          output: { type: 'string', description: 'final answer (one-shot mode).' },
          stopReason: { type: 'string', description: 'one-shot stop reason.' },
          role: { type: 'string', description: 'resolved role id.' },
          permissionMode: { type: 'string', description: 'resolved product permission mode.' },
        },
      },
      render: (_args, value) => {
        if (value.childId) return [{ type: 'text', text: `started product subagent ${value.childId} (role ${value.role})` }]
        return [{ type: 'text', text: value.output }]
      },
    },
    async execute(args, exec) {
      const parent = exec.agent
      const role = roles.get(args.role || 'general')
      if (!role) throw new Error(`product_delegate: unknown role "${args.role}" and no general fallback`)
      const provider = args.provider || role.provider
      if (!provider) throw new Error(`product_delegate: no provider — pass provider or set it on role "${role.id}"`)
      const detected = availability[provider]
      if (!detected || !detected.registered) {
        throw new Error(`product agent "${provider}" is not available${detected ? `: ${detected.reason}` : ''}`)
      }
      const bridge = bridges[provider]
      // Delegation permission ceiling: permissions inherit DOWN the
      // delegation tree. A product child (a continuable subagent with a live
      // binding) may never grant a descendant MORE permission than it has
      // itself — otherwise a read-only child could escape its restriction by
      // spawning a full-permission grandchild. `readonly < default < full`.
      const callerRecord = parent ? bindings.get(parent.session.id) : undefined
      const requestedRank = PERM_RANK[role.permissionMode] ?? 1
      if (callerRecord) {
        const callerMode = callerRecord.settings && callerRecord.settings.permissionMode
        const callerRank = callerMode === undefined ? 1 : (PERM_RANK[callerMode] ?? 1)
        if (requestedRank > callerRank) {
          throw new Error(
            `product_delegate: permission escalation blocked — this subagent's permissionMode is "${callerMode || 'default'}" and cannot spawn a "${role.permissionMode}" descendant. The delegating parent must grant the needed permission in the first place.`,
          )
        }
      }
      const settings = { permissionMode: role.permissionMode }
      if (args.model) settings.model = args.model
      if (args.reasoning_effort) settings.reasoningEffort = args.reasoning_effort
      // role instructions are sent to the REMOTE product; the relay pipe
      // persona is fixed and never includes write-capable tools.
      const task = role.instructions ? `${role.instructions}\n\n${args.task}` : args.task
      if (args.background === false) {
        const cwd = parentCwd(parent)
        const remote = await bridge.create(cwd)
        try {
          const out = await bridge.submit(remote, task, exec.signal, cwd, settings)
          await bridge.dispose(remote).catch(() => {})
          return { output: out.text, stopReason: out.stopReason, role: role.id, permissionMode: role.permissionMode }
        } catch (error) {
          await bridge.dispose(remote).catch(() => {})
          throw error
        }
      }
      if (state.activeChildren >= maxConcurrent) {
        throw new Error(`product_delegate: concurrency limit reached (${maxConcurrent} active children). Wait for a subagent to settle (subagent_progress / product_wait) or raise maxConcurrentChildren.`)
      }
      // The relay is ALWAYS a read-only pipe: product_submit only, plus
      // product_delegate exactly when the role allows delegation. No
      // write-capable tool is ever exposed to the relay model.
      const allow = role.allowDelegation ? ['product_submit', 'product_delegate'] : ['product_submit']
      const start = await ctx.subagents.startContinuable({
        provider,
        label: `${role.id}: ${args.task.slice(0, 50)}`,
        request: {
          prompt: [{ type: 'text', text: task }],
          parent,
          persona: providerPersona(provider, providers[provider]) + (role.allowDelegation
            ? ' You MAY delegate subtasks to your own subagents via product_delegate (choose an appropriate role) and integrate the answers.'
            : ''),
          toolFilter: { allow },
        },
        signal: exec.signal,
      })
      state.activeChildren += 1
      const record = bindings.get(start.childId)
      if (record) record.settings = settings
      return { childId: start.childId, role: role.id, permissionMode: role.permissionMode }
    },
  }))
}
