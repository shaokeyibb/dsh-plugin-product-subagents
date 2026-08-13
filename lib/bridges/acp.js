import { Readable, Writable } from 'node:stream'
import * as acp from '@agentclientprotocol/sdk'
import { spawnProduct } from '../run.js'

/**
 * ACP bridge: one persistent child process speaking the Agent Client Protocol
 * over stdio (e.g. `opencode acp`, `agent acp` (Cursor), `cbc --acp`). A session
 * lives in that process; later prompts on the same session continue the
 * conversation, and `session/load` reconnects a persisted session id.
 *
 * Model selection: ACP has no portable model flag. `settings.model` is
 * attempted through `setSessionConfigOption` when the agent advertises the
 * option (best-effort, silently ignored otherwise); configure the agent's own
 * model via its CLI flags / config (`args` option) instead.
 */
export function createAcpBridge(options = {}) {
  const command = options.command || 'opencode'
  const args = options.args || ['acp']
  const env = options.env || {}

  function makeClient(onText) {
    return {
      async sessionUpdate(params) {
        const update = params && params.update
        if (update && update.sessionUpdate === 'agent_message_chunk') {
          const content = update.content
          if (content && content.type === 'text' && typeof content.text === 'string') onText(content.text)
        }
        return {}
      },
      async requestPermission() {
        // unattended: every permission request is rejected
        return { outcome: { outcome: 'rejected' } }
      },
      async readTextFile() {
        throw new Error('product-subagents: ACP readTextFile is not supported')
      },
      async writeTextFile() {
        throw new Error('product-subagents: ACP writeTextFile is not supported')
      },
    }
  }

  async function connect(cwd) {
    const proc = spawnProduct(command, args, {
      stdio: ['pipe', 'pipe', 'inherit'],
      cwd,
      env: { ...process.env, ...env },
    })
    const input = Writable.toWeb(proc.stdin)
    const output = Readable.toWeb(proc.stdout)
    const stream = acp.ndJsonStream(input, output)
    let textBuffer = ''
    let progress = {}
    const client = makeClient((text) => {
      textBuffer += text
      progress = { ...progress, lastChunkAt: Date.now(), receivedChars: (progress.receivedChars || 0) + text.length, partialPreview: textBuffer.slice(-200) }
    })
    const connection = new acp.ClientSideConnection(() => client, stream)
    await connection.initialize({
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
    })
    return {
      proc,
      connection,
      progress: () => progress,
      drainText() {
        const text = textBuffer
        textBuffer = ''
        return text
      },
    }
  }

  /** Whether the ACP server process is gone (exited or killed). */
  function transportDead(remote) {
    if (!remote || !remote.proc) return true
    return remote.proc.exitCode !== null || remote.proc.signalCode !== null
  }

  /**
   * Re-establish the ACP connection after the server process died: spawn a
   * fresh server, try session/load for the same session id (when the agent
   * supports it), else fall back to a new session. Mutates `remote` in place.
   */
  async function reconnectRemote(remote, cwd) {
    const handle = await connect(cwd)
    let id = remote.sessionId
    try {
      await handle.connection.loadSession({ sessionId: id })
      handle.sessionId = id
    } catch {
      const session = await handle.connection.newSession({ cwd, mcpServers: [] })
      handle.sessionId = session.sessionId
    }
    remote.proc = handle.proc
    remote.connection = handle.connection
    remote.drainText = handle.drainText
    remote.progressRef = handle.progress
    remote.sessionId = handle.sessionId
  }

  return {
    async create(cwd) {
      const handle = await connect(cwd)
      const session = await handle.connection.newSession({ cwd, mcpServers: [] })
      handle.sessionId = session.sessionId
      handle.progressRef = handle.progress
      return { kind: 'acp', ...handle }
    },
    async submit(remote, task, signal, cwd, settings = {}) {
      if (settings.model) {
        try {
          await remote.connection.setSessionConfigOption({ sessionId: remote.sessionId, configId: 'model', value: settings.model })
        } catch {
          // agent does not support the option; its own config decides
        }
      }
      // The persistent server process may have died between turns (crash, OOM,
      // manual kill). The session id itself was captured at session/new, so
      // continuity is preserved wherever the agent allows session/load. If the
      // prompt fails on a dead transport, reconnect once and retry (the prompt
      // cannot have been delivered to a dead process, so a retry is safe).
      try {
        const response = await remote.connection.prompt({
          sessionId: remote.sessionId,
          prompt: [{ type: 'text', text: task }],
        })
        const rawStop = response && response.stopReason ? String(response.stopReason) : 'end_turn'
        const stopReason = rawStop === 'end_turn' ? 'completed' : rawStop
        return { text: remote.drainText(), stopReason }
      } catch (error) {
        if (!transportDead(remote)) throw error
        await reconnectRemote(remote, cwd)
        const response = await remote.connection.prompt({
          sessionId: remote.sessionId,
          prompt: [{ type: 'text', text: task }],
        })
        const rawStop = response && response.stopReason ? String(response.stopReason) : 'end_turn'
        const stopReason = rawStop === 'end_turn' ? 'completed' : rawStop
        return { text: remote.drainText(), stopReason }
      }
    },
    async reconnect(sessionId, cwd) {
      const handle = await connect(cwd)
      let id = sessionId
      try {
        await handle.connection.loadSession({ sessionId: id })
      } catch {
        // the agent does not support loadSession (negotiated per child):
        // fall back to a fresh session
        const session = await handle.connection.newSession({ cwd, mcpServers: [] })
        id = session.sessionId
      }
      handle.sessionId = id
      handle.progressRef = handle.progress
      return { kind: 'acp', ...handle }
    },
    async dispose(remote) {
      try {
        await remote.connection.closeSession({ sessionId: remote.sessionId })
      } catch {
        // already closed or the process is gone
      }
      try {
        remote.proc.kill('SIGTERM')
      } catch {
        // already gone
      }
    },
  }
}
