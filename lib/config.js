import { z } from 'zod'

/**
 * Configuration validation for the plugin. Invalid config fails LOUDLY at
 * apply time with a precise message, instead of surfacing as a confusing
 * runtime error later.
 */

const providerDefSchema = z.object({
  type: z.enum(['claude', 'codex', 'acp']).optional(),
  command: z.string().min(1).optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  timeoutMs: z.number().int().positive().optional(),
})

export const pluginConfigSchema = z.object({
  providers: z.record(z.string(), providerDefSchema).optional(),
  registryPath: z.string().optional(),
  idleTimeoutMs: z.number().int().min(0).optional(),
  maxConcurrentChildren: z.number().int().positive().optional(),
  rolesDir: z.string().optional(),
}).passthrough()

/** Validate and return a normalized config; throws with a clear message. */
export function validateConfig(config = {}) {
  const result = pluginConfigSchema.safeParse(config)
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    throw new Error(`product-subagents: invalid config — ${issues.join('; ')}`)
  }
  return result.data
}
