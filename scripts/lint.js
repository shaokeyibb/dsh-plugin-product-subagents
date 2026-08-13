// Cross-platform syntax check: `node --check` every module.
// The old `for f in …; do …; done` lint script was POSIX-shell syntax that
// cmd.exe cannot run, which broke `npm run lint` on Windows CI.
import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
const files = []

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) walk(p)
    else if (entry.name.endsWith('.js')) files.push(p)
  }
}

walk(join(root, 'lib'))
walk(join(root, 'test'))

for (const file of files) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' })
}

console.log(`lint ok: ${files.length} files`)
