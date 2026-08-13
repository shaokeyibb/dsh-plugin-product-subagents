import { defineTool } from '@deepseek-ai/dsh-tools'

/**
 * The per-child bridge tool: continuable children submit task work to their
 * bound remote product session. Only children with a binding (created by
 * product_delegate) can call it; recovery reconnects a lost session from the
 * durable registry or the child's own log.
 */
export function registerProductSubmit(ctx, deps) {
  const { bindings, MARKER, recoverRemoteSessionId, bridges, registry, persistRemote, cancelDispose } = deps
  ctx.tools.register(defineTool({
    name: 'product_submit',
    description: 'Submit one task to the persistent remote product session bound to this agent (Codex / Claude Code / ACP CLI) and return the product agent\'s answer. The remote session remembers the full conversation, so later submissions continue it. Use this for all task work while you are a product subagent.',
    parameters: {
      task: { type: 'string', required: true, description: 'The task text to send to the remote product agent.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { text: { type: 'string', required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args, exec) {
      const agent = exec && exec.agent
      if (!agent || !agent.session) throw new Error('product_submit requires a calling agent session')
      const childSessionId = agent.session.id
      // This child is being used again — cancel any pending idle disposal so a
      // fast continuation never pays a reconnect.
      cancelDispose(childSessionId)
      let record = bindings.get(childSessionId)
      if (!record) {
        // The binding is gone (idle disposal or restart). Recovery order:
        // 1) the durable registry (reliable — written when the remote id was
        //    first known), 2) the child's own session log (marker fallback).
        const cwd = (agent.session.header && agent.session.header.cwd) || process.cwd()
        const persisted = registry.get(childSessionId)
        const recovered = persisted && bridges[persisted.product]
          ? { product: persisted.product, sessionId: persisted.remoteId }
          : recoverRemoteSessionId(agent.session)
        const bridge = recovered ? bridges[recovered.product] : undefined
        if (!bridge) throw new Error('product_submit: no remote product session is bound to this agent (recovery failed)')
        const remote = await bridge.reconnect(recovered.sessionId, cwd)
        record = { product: recovered.product, bridge, remote, settings: undefined }
        bindings.set(childSessionId, record)
      }
      const cwd = (agent.session.header && agent.session.header.cwd) || process.cwd()
      try {
        const out = await record.bridge.submit(record.remote, args.task, exec.signal, cwd, record.settings)
        const remoteId = record.remote.sessionId || record.remote.threadId
        const marker = remoteId ? `${MARKER}${record.product}:${remoteId}` : ''
        const text = marker ? `${out.text}\n${marker}` : out.text
        return { text }
      } finally {
        // Persist the remote id whenever it becomes known (after a successful
        // submit, or after the claude bridge recovered it from disk on a
        // failed/interrupted submit).
        persistRemote(childSessionId, record, cwd)
      }
    },
  }))
}
