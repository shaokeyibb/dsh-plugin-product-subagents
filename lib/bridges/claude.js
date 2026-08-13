import { readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { runCommand } from '../run.js'

/**
 * Claude Code bridge: one `claude -p --output-format json` invocation per
 * message. The first call creates a session (the CLI returns `session_id` in
 * the FINAL json line — late), every later call passes `--resume
 * <session_id>` so the product keeps the full conversation context. Sessions
 * are resumable by id across restarts. Model and reasoning effort are passed
 * through as `--model` / `--effort`.
 *
 * Because `session_id` is only known when a submission completes, an
 * interrupted first submission (e.g. the parent interrupts mid-essay) would
 * lose the id and the next submission would start a fresh session. The
 * `recoverLatestSessionId` fallback recovers it from Claude's own session
 * store on disk so the conversation continues instead of resetting.
 */
export function createClaudeBridge(options = {}) {
  const command = options.command || 'claude'
  const env = options.env || {}
  const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 300000)
  return {
    async create() {
      return { kind: 'claude', sessionId: undefined, progress: {} }
    },
    async submit(remote, task, signal, cwd, settings = {}) {
      const args = ['-p', '--output-format', 'json']
      if (settings.model) args.push('--model', settings.model)
      if (settings.reasoningEffort) args.push('--effort', settings.reasoningEffort)
      // Product permission mode (applies to the remote agent, never the relay):
      //   readonly -> plan mode (read-only exploration)
      //   full     -> bypass all permission checks
      //   default  -> the product's own configured defaults
      if (settings.permissionMode === 'readonly') args.push('--permission-mode', 'plan')
      else if (settings.permissionMode === 'full') args.push('--dangerously-skip-permissions')
      if (remote.sessionId) args.push('--resume', remote.sessionId)
      args.push(task)
      remote.progress = { ...remote.progress, busySince: Date.now(), stage: 'claude running', receivedChars: 0 }
      let stdout
      try {
        ;({ stdout } = await runCommand(command, args, {
          env,
          signal,
          cwd,
          timeoutMs,
          onStdout: (chunk) => {
            remote.progress = {
              ...remote.progress,
              lastChunkAt: Date.now(),
              receivedChars: (remote.progress.receivedChars || 0) + chunk.length,
            }
          },
        }))
      } catch (error) {
        // The submission was interrupted or failed before claude reported its
        // session id. Claude has already persisted the session on disk — pick
        // it up so the NEXT submission resumes this conversation instead of
        // starting a fresh one.
        if (!remote.sessionId) remote.sessionId = recoverLatestSessionId(cwd)
        throw error
      }
      remote.progress = { ...remote.progress, busySince: undefined, lastChunkAt: Date.now(), stage: 'answer received' }
      const line = stdout.split('\n').map((s) => s.trim()).filter(Boolean).pop()
      let parsed
      try {
        parsed = JSON.parse(line)
      } catch {
        throw new Error('claude returned unparseable output: ' + stdout.slice(0, 300))
      }
      if (parsed.is_error) throw new Error(String(parsed.error || 'claude returned an error'))
      if (parsed.session_id) remote.sessionId = parsed.session_id
      const text = String(parsed.result ?? parsed.text ?? '').trim()
      return { text, stopReason: 'completed' }
    },
    async reconnect(sessionId) {
      return { kind: 'claude', sessionId, progress: {} }
    },
    async dispose() {
      // each submission is a separate process; nothing to tear down
    },
  }
}

/**
 * Find the most recently modified Claude session file for a workspace and
 * return its session id. Claude stores sessions as
 * `~/.claude/projects/<escaped-cwd>/<session-uuid>.jsonl`; the newest one for
 * this cwd is the one an interrupted submission just created.
 */
function recoverLatestSessionId(cwd) {
  try {
    // escape BOTH separators so Windows drive paths (`C:\…`) map like claude's own escaping
    const projectDir = join(homedir(), '.claude', 'projects', String(cwd).replaceAll('/', '-').replaceAll('\\', '-'))
    let newest
    let newestMs = -1
    for (const entry of readdirSync(projectDir)) {
      if (!entry.endsWith('.jsonl')) continue
      const stat = statSyncSafe(join(projectDir, entry))
      if (stat && stat.mtimeMs > newestMs) {
        newestMs = stat.mtimeMs
        newest = entry
      }
    }
    if (!newest) return undefined
    return newest.slice(0, -'.jsonl'.length)
  } catch {
    return undefined
  }
}

function statSyncSafe(path) {
  try {
    return statSync(path)
  } catch {
    return undefined
  }
}
