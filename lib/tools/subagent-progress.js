import { defineTool } from '@deepseek-ai/dsh-tools'

/** Progress tool: latest status, internal trace, token usage of one child. */
export function registerSubagentProgress(ctx, deps) {
  const { bindings, foldProgress, foldTrace, foldTokenUsage } = deps
  ctx.tools.register(defineTool({
    name: 'subagent_progress',
    description: 'Report the latest progress of one product subagent: lifecycle status, the pinned product and remote session, the current/last task, the latest answer, and live activity while a turn is in flight.',
    parameters: {
      subagent_id: { type: 'string', required: true, description: 'The child session id returned by product_delegate.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec) {
      const childId = args.subagent_id
      const record = bindings.get(childId)
      const session = ctx.get('sessions') ? ctx.get('sessions').get(childId) : undefined
      const fold = session ? foldProgress(session) : null
      let listStatus = null
      try {
        const children = await ctx.subagents.listChildren(exec.agent.session.id, exec.signal)
        const me = children.find((c) => c.id === childId)
        if (me) listStatus = { activity: me.activity, mode: me.mode, hasChildren: me.hasChildren, label: me.label }
      } catch {
        listStatus = null
      }
      const remoteId = record && (record.remote.sessionId || record.remote.threadId)
      const inFlight = record && record.remote.progress && record.remote.progress.busySince
        ? { ...record.remote.progress, busySince: new Date(record.remote.progress.busySince).toISOString() }
        : undefined
      return {
        childId,
        status: listStatus ? listStatus.activity : session ? 'running' : 'stored',
        mode: listStatus ? listStatus.mode : undefined,
        label: listStatus ? listStatus.label : undefined,
        pinnedProduct: record ? record.product : (fold && fold.product) || undefined,
        remoteSessionId: remoteId || (fold && fold.remoteSessionId) || undefined,
        // model: explicit override, else inherited from the product's own config
        model: record && record.settings && record.settings.model
          ? record.settings.model
          : 'inherit (product default)',
        reasoningEffort: record && record.settings && record.settings.reasoningEffort
          ? record.settings.reasoningEffort
          : 'inherit (product default)',
        turn: fold ? fold.turn : undefined,
        stepCount: fold ? fold.stepCount : 0,
        lastTask: fold ? fold.lastTask : undefined,
        lastAnswer: fold ? fold.lastAnswer : undefined,
        lastActivityAt: fold && fold.lastActivityAt ? new Date(fold.lastActivityAt).toISOString() : undefined,
        tokenUsage: session ? foldTokenUsage(session) : undefined,
        // internal trace: recent turn/step/tool/answer events from the child's own log
        trace: session ? foldTrace(session) : undefined,
        inFlight,
      }
    },
  }))
}
