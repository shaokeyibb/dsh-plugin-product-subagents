import { spawn, spawnSync } from 'node:child_process'

/**
 * Cross-platform product CLI launch.
 *
 * On POSIX, spawn the command directly. On Windows, npm-installed CLIs
 * (claude, codex, cbc, opencode, agent, …) are `.cmd`/`.bat` shims that plain
 * `spawn` cannot execute (ENOENT), so the whole invocation is run through
 * `cmd.exe` with verbatim arguments. Any argument containing spaces or cmd
 * metacharacters is double-quoted so task text survives unparsed.
 */
const IS_WIN = process.platform === 'win32'

export function cmdQuote(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`
}

export function winArgs(command, args) {
  // cmd /S /C strips the FIRST and LAST quote character of the whole line,
  // so a bare "codex" prefix becomes codex" and the lookup fails with
  // "'codex\" ...' is not recognized". Wrap the entire invocation in one
  // outer pair of quotes: /S then strips exactly that pair, leaving the
  // per-argument quotes intact for cmd's normal tokenizer.
  const parts = [
    cmdQuote(command),
    ...args.map((a) => (/[ "&|<>^()]/.test(a) ? cmdQuote(a) : a)),
  ]
  return ['/d', '/s', '/c', '"' + parts.join(' ') + '"']
}

export function spawnProduct(command, args, options) {
  if (!IS_WIN) return spawn(command, args, options)
  return spawn('cmd.exe', winArgs(command, args), { ...options, windowsVerbatimArguments: true })
}

export function spawnSyncProduct(command, args, options) {
  if (!IS_WIN) return spawnSync(command, args, options)
  return spawnSync('cmd.exe', winArgs(command, args), { ...options, windowsVerbatimArguments: true })
}

/**
 * Run one product CLI command to completion, returning stdout/stderr.
 * Cancellation (signal) and a hard timeout bound the wait; on timeout the
 * process tree is SIGKILLed so a wedged product never hangs the caller.
 * `onStdout` receives each stdout chunk as it arrives (for live progress).
 */
export function runCommand(command, args, options = {}) {
  const { env = {}, cwd, signal, timeoutMs = 300000, onStdout, allowNonZero = false } = options
  return new Promise((resolve, reject) => {
    const child = spawnProduct(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd,
      env: { ...process.env, ...env },
    })
    // Products never read stdin; hand them an immediate EOF (some CLIs, e.g.
    // codex exec, misbehave when the stream is outright ignored).
    child.stdin.end()
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => {
      stdout += d
      if (onStdout) { try { onStdout(String(d)) } catch { /* progress is best-effort */ } }
    })
    child.stderr.on('data', (d) => { stderr += d })
    const onAbort = () => { try { child.kill('SIGTERM') } catch { /* already gone */ } }
    if (signal && signal.aborted) onAbort()
    else if (signal && typeof signal.addEventListener === 'function') signal.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(() => { try { child.kill('SIGKILL') } catch { /* already gone */ } }, timeoutMs)
    child.on('error', (error) => {
      clearTimeout(timer)
      if (signal && typeof signal.removeEventListener === 'function') signal.removeEventListener('abort', onAbort)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (signal && typeof signal.removeEventListener === 'function') signal.removeEventListener('abort', onAbort)
      if (code === 0 || allowNonZero) resolve({ stdout, stderr, code })
      else reject(new Error(`command "${command} ${args.join(' ')}" exited ${code}: ${(stderr || stdout).slice(0, 600)}`))
    })
  })
}

/** cwd of the delegating parent session, with a safe fallback. */
export function parentCwd(parent) {
  try {
    const cwd = parent && parent.session && parent.session.header && parent.session.header.cwd
    return cwd || process.cwd()
  } catch {
    return process.cwd()
  }
}
