import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_PROVIDER_NAMESPACE, buildProviders, runtimeProviderName } from '../lib/providers.js'
import { validateConfig } from '../lib/config.js'

/**
 * The plugin's provider keys are the same strings the official
 * `@deepseek-ai/dsh-subagent-*` plugins register under. `registerProvider`
 * rejects a duplicate name and that rejection fails the whole loader entry, so
 * every registration must go out under a plugin-owned id instead.
 */
const OFFICIAL_IDS = ['claude-code', 'codex', 'acp']

test('every built-in registers under a plugin-owned id, not an official one', () => {
  for (const key of Object.keys(buildProviders({}))) {
    const id = runtimeProviderName(key)
    assert.equal(id, `${DEFAULT_PROVIDER_NAMESPACE}:${key}`)
    assert.ok(!OFFICIAL_IDS.includes(id), `${id} collides with an official provider id`)
  }
})

test('custom config.providers are namespaced the same way', () => {
  const providers = buildProviders({ providers: { cursor: { type: 'acp', command: 'agent', args: ['acp'] } } })
  assert.ok('cursor' in providers)
  assert.equal(runtimeProviderName('cursor'), 'product-subagents:cursor')
})

test('the plugin-facing key is unchanged — only the registered id is namespaced', () => {
  const providers = buildProviders({})
  for (const key of OFFICIAL_IDS) assert.equal(providers[key].name, key)
})

test('an empty namespace restores the bare pre-0.4.0 ids', () => {
  assert.equal(runtimeProviderName('claude-code', ''), 'claude-code')
})

test('config accepts an explicit providerNamespace and rejects a malformed one', () => {
  assert.equal(validateConfig({ providerNamespace: '' }).providerNamespace, '')
  assert.equal(validateConfig({ providerNamespace: 'my-plugin' }).providerNamespace, 'my-plugin')
  assert.equal(validateConfig({}).providerNamespace, undefined)
  assert.throws(() => validateConfig({ providerNamespace: 'has space' }), /invalid config/)
})
