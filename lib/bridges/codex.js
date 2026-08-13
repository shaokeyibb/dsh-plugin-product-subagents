import { runCommand } from '../run.js'

/**
 * Codex bridge: one `codex exec --json` invocation per message. The first
 * call starts a fresh session; the JSONL event stream carries the thread id
 * (`thread.started`), which later calls resume via the `exec resume
 * <thread_id>` subcommand (0.147 moved resume to a subcommand — a plain
 * `--resume` flag no longer parses). `--skip-git-repo-check` keeps the CLI
 * working outside a git checkout. Model / reasoning effort pass through as
 * `-c model=…` / `-c model_reasoning_effort=…` (the same keys as
 * ~/.codex/config.toml).
 *
 * Note: the JSONL event names target codex-cli 0.147.0, with a fallback for
 * older underscore event shapes and plain-text output.
 */
export function createCodexBridge(options = {}) {
  const command = options.command || 'codex'
  const env = options.env || {}
  const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 300000)
  return {
    async create() {
      return { kind: 'codex', threadId: undefined, progress: {} }
    },
    async submit(remote, task, signal, cwd, settings = {}) {
      const args = ['exec', '--json', '--skip-git-repo-check']
      if (settings.model) args.push('-c', `model=${settings.model}`)
      if (settings.reasoningEffort) args.push('-c', `model_reasoning_effort=${settings.reasoningEffort}`)
      // Product permission mode (applies to the remote agent, never the relay):
      //   readonly -> read-only sandbox
      //   full     -> bypass approvals and sandbox (dangerous, role-gated)
      //   default  -> the product's own configured sandbox
      if (settings.permissionMode === 'readonly') args.push('-s', 'read-only')
      else if (settings.permissionMode === 'full') args.push('--dangerously-bypass-approvals-and-sandbox')
      if (remote.threadId) {
        args.push('resume', remote.threadId)
      }
      args.push(task)
      remote.progress = { ...remote.progress, busySince: Date.now(), stage: 'codex running', receivedChars: 0 }
      // allowNonZero: codex reflects a failed turn in its exit code, and its
      // JSONL error events are the authoritative diagnosis — parse them first.
      let lineBuffer = ''
      const { stdout, stderr, code } = await runCommand(command, args, {
        env,
        signal,
        cwd,
        timeoutMs,
        allowNonZero: true,
        onStdout: (chunk) => {
          remote.progress = {
            ...remote.progress,
            lastChunkAt: Date.now(),
            receivedChars: (remote.progress.receivedChars || 0) + chunk.length,
          }
          // Capture the thread id INCREMENTALLY (thread.started is the first
          // event, so even an interrupted submission keeps the id and the next
          // submission can resume the same thread — the late-capture bug class
          // that hit the claude bridge must not apply here).
          lineBuffer += chunk
          let nl
          while ((nl = lineBuffer.indexOf('\n')) >= 0) {
            const line = lineBuffer.slice(0, nl).trim()
            lineBuffer = lineBuffer.slice(nl + 1)
            if (!line) continue
            let event
            try {
              event = JSON.parse(line)
            } catch {
              continue
            }
            if (event && event.type === 'thread.started' && typeof event.thread_id === 'string' && !remote.threadId) {
              remote.threadId = event.thread_id
            }
          }
        },
      })
      remote.progress = { ...remote.progress, busySince: undefined, lastChunkAt: Date.now(), stage: 'answer received' }
      let text = ''
      let threadId = remote.threadId
      for (const line of stdout.split('\n')) {
        if (!line.trim()) continue
        let event
        try {
          event = JSON.parse(line)
        } catch {
          continue
        }
        const type = event && event.type
        const payload = (event && event.payload) || {}
        // codex-cli 0.147+ emits dotted top-level events: thread.started
        // {thread_id}, item.completed {item:{type:'agent_message',text}},
        // turn.completed {usage}. Older shapes used thread_started /
        // agent_message / run_result with a payload wrapper — kept as fallback.
        if (type === 'thread.started' && typeof event.thread_id === 'string') threadId = event.thread_id
        if (type === 'item.completed' && event.item && event.item.type === 'agent_message' && typeof event.item.text === 'string') text += event.item.text
        if (type === 'thread_started' && typeof payload.thread_id === 'string') threadId = payload.thread_id
        if (type === 'agent_message' && typeof payload.text === 'string') text += payload.text
        if (type === 'run_result' && typeof payload.result === 'string') text = payload.result
        // Surface codex's own failures (usage limits, auth, tool errors) even
        // when the process still exits 0.
        if (type === 'error' && typeof event.message === 'string') throw new Error(`codex: ${event.message}`)
        if (type === 'turn.failed' && event.error && typeof event.error.message === 'string') throw new Error(`codex: ${event.error.message}`)
      }
      if (code !== 0 && !text) throw new Error(`codex exited ${code}: ${(stderr || stdout).slice(0, 400)}`)
      if (!text) {
        const plain = stdout.split('\n').filter((l) => l.trim() && !l.trim().startsWith('{')).join('\n').trim()
        if (plain) text = plain
      }
      remote.threadId = threadId
      return { text, stopReason: 'completed' }
    },
    async reconnect(sessionId) {
      return { kind: 'codex', threadId: sessionId, progress: {} }
    },
    async dispose() {
      // each submission is a separate process; nothing to tear down
    },
  }
}
