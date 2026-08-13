import { defineTool } from '@deepseek-ai/dsh-tools'

/** Role catalog tool: lists the declarative role library for the model. */
export function registerProductRoles(ctx, deps) {
  const { roles } = deps
  ctx.tools.register(defineTool({
    name: 'product_roles',
    description: 'List the declarative subagent roles: id, description, pinned provider, product permission mode (readonly/default/full) and whether the role may delegate to its own subagents. Use a role with product_delegate.',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute() {
      return {
        roles: roles.list().map((r) => ({
          id: r.id,
          description: r.description,
          provider: r.provider || '(caller chooses)',
          permissionMode: r.permissionMode,
          allowDelegation: r.allowDelegation,
        })),
      }
    },
  }))
}
