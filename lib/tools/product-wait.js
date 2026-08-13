import { defineTool } from '@deepseek-ai/dsh-tools'

/**
 * Wait tool: attach to a continuable child and block until it settles,
 * returning its final answer. Event-driven (subagent/end), never polling.
 */
export function registerProductWait(ctx, deps) {
  const { bindings, foldProgress, foldTrace } = deps
  ctx.tools.register(defineTool({
    name: 'product_wait',
    description: 'Block until the given product subagent finishes (or the timeout elapses), then return its final answer, stop reason, and latest trace. Attaches to a background subagent id returned by product_delegate — no polling needed. Returns immediately with status "ready" when the child already settled, and "timeout"/"aborted" otherwise.',
    parameters: {
      subagent_id: { type: 'string', required: true, description: 'The continuable child session id returned by product_delegate.' },
      timeout_ms: { type: 'number', description: 'Max milliseconds to wait (default 300000, capped 600000).' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec) {
      const childId = args.subagent_id
      const timeoutMs = Math.min(Math.max(Number(args.timeout_ms) || 300000, 1000), 600000)
      const parent = exec.agent
      const sessionSvc = ctx.get('sessions')

      const foldNow = () => {
        const session = sessionSvc ? sessionSvc.get(childId) : undefined
        return session ? foldProgress(session) : null
      }

      let activity = 'unknown'
      try {
        const children = await ctx.subagents.listChildren(parent.session.id, exec.signal)
        const me = children.find((c) => c.id === childId)
        activity = me ? me.activity : 'unknown'
      } catch {
        activity = 'unknown'
      }

      let outcome
      if (activity === 'unknown') {
        outcome = { status: 'unknown', note: 'no such subagent under this parent (or listing unavailable)' }
      } else if (activity === 'inactive') {
        // already settled: report immediately
        outcome = { status: 'ready' }
      } else {
        // live: await the child's next settlement (subagent/end is scoped to
        // the delegating parent, so only this parent's children match)
        outcome = await new Promise((resolve) => {
          let done = false
          const finish = (value) => { if (done) return; done = true; off(); clearTimeout(timer); resolve(value) }
          const off = ctx.on('subagent/end', (info) => {
            if (info && info.id === childId) finish({ status: 'completed', info })
          })
          const timer = setTimeout(() => finish({ status: 'timeout' }), timeoutMs)
          if (exec.signal && exec.signal.aborted) finish({ status: 'aborted' })
          else if (exec.signal && typeof exec.signal.addEventListener === 'function') {
            exec.signal.addEventListener('abort', () => finish({ status: 'aborted' }), { once: true })
          }
        })
      }

      const fold = foldNow()
      const lastAssistant = outcome.info && outcome.info.lastAssistantMessage
      const answer = lastAssistant
        ? lastAssistant.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n')
        : (fold ? fold.lastAnswer : undefined)
      return {
        childId,
        status: outcome.status,
        stopReason: outcome.info ? outcome.info.stopReason : undefined,
        answer: answer || undefined,
        pinnedProduct: fold ? fold.product : undefined,
        remoteSessionId: fold ? fold.remoteSessionId : undefined,
        trace: fold ? foldTrace(sessionSvc ? sessionSvc.get(childId) : undefined) : undefined,
      }
    },
  }))
}
