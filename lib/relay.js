import { providerPersona } from './providers.js'

export function relayToolFilter(allowDelegation) {
  return { allow: allowDelegation ? ['product_submit', 'product_delegate'] : ['product_submit'] }
}

export function relayPersona(product, provider, allowDelegation) {
  const persona = providerPersona(product, provider)
  return allowDelegation
    ? persona + ' You MAY delegate subtasks via product_delegate. Choose an appropriate role and integrate the answers.'
    : persona
}

/** Apply the relay policy on agent creation and cold resume, before any turn. */
export function registerRelayScope(ctx, { bindings, providers, registry, runtimeName }) {
  const products = new Map(Object.keys(providers).map((product) => [runtimeName(product), product]))
  ctx.on('agent/created', ({ agent }) => {
    const descriptor = agent.session.ownEvents().find((event) => event.type === 'subagent/descriptor')
    const product = products.get(descriptor?.data?.provider)
    if (product === undefined) return

    const record = bindings.get(agent.session.id) ?? registry.get(agent.session.id)
    const allowDelegation = record?.allowDelegation === true
    agent.ctx.tools.restrict(relayToolFilter(allowDelegation))
    agent.ctx.systemPrompt.section({
      name: 'product-subagents:relay-persona',
      order: agent.ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'),
      text: relayPersona(product, providers[product], allowDelegation),
    })
  })
}
