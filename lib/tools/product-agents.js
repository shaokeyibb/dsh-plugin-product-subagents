import { defineTool } from '@deepseek-ai/dsh-tools'

/** Overview tool: detected provider availability + live children. */
export function registerProductAgents(ctx, deps) {
  const { bindings, availability } = deps
  ctx.tools.register(defineTool({
    name: 'product_agents',
    description: 'List detected product CLI agents with availability, plus every live product subagent with its pinned product and activity.',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec) {
      const availabilityView = Object.fromEntries(
        Object.entries(availability).map(([name, v]) => [name, {
          registered: v.registered,
          commandPresent: v.command,
          auth: v.auth.ok ? v.auth.note : v.auth.note,
          note: v.reason,
        }]),
      )
      const children = []
      try {
        const list = await ctx.subagents.listChildren(exec.agent.session.id, exec.signal)
        for (const child of list) {
          const record = bindings.get(child.id)
          children.push({
            id: child.id,
            product: record ? record.product : undefined,
            activity: child.activity,
            mode: child.mode,
            label: child.label,
            pinned: Boolean(record),
            model: record && record.settings && record.settings.model ? record.settings.model : 'inherit',
          })
        }
      } catch {
        // children listing unavailable; availability still reported
      }
      return { availability: availabilityView, children }
    },
  }))
}
