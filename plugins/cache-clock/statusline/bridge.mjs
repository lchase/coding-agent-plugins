#!/usr/bin/env node
// cache-clock native bridge. `/cache-clock setup` points the user statusLine at this script.
// A plugin cannot register a status line (only `agent` and `subagentStatusLine` take effect
// in plugin settings), and the mods API has no prompt_cache, so the band reads Claude Code's
// own figures through a file this script writes:
//   1. run the user's original status line unchanged, if setup saved one, and print its output
//   2. write stdin JSON's prompt_cache (Claude Code v2.1.251+) to
//      <config>/cache-clock/native-<session_id>.json
// Docs: https://code.claude.com/docs/en/statusline#prompt-cache-fields
import { spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const STALE_MS = 2 * 60 * 60 * 1000
const dir = join(process.env.CLAUDE_CONFIG_DIR?.replace(/\/+$/, '') || join(homedir(), '.claude'), 'cache-clock')

let stdin = ''
process.stdin.setEncoding('utf8')
for await (const chunk of process.stdin) stdin += chunk

const wrapped = readWrapped(process.argv[2])
if (wrapped) {
  const run = spawnSync(wrapped, { shell: true, input: stdin, encoding: 'utf8', timeout: 5000 })
  const out = (run.stdout ?? '').replace(/\n+$/, '')
  if (out) process.stdout.write(out + '\n')
  if (run.stderr) process.stderr.write(run.stderr)
}

try {
  const input = JSON.parse(stdin)
  const id = String(input.session_id ?? '')
  if (/^[\w-]+$/.test(id)) {
    mkdirSync(dir, { recursive: true })
    const file = join(dir, `native-${id}.json`)
    const tmp = join(dir, `.native-${id}.${process.pid}.tmp`)
    const body = {
      writtenAt: Date.now(),
      prompt_cache: input.prompt_cache ?? null,
      model: typeof input.model?.id === 'string' ? input.model.id : null,
    }
    writeFileSync(tmp, JSON.stringify(body))
    renameSync(tmp, file)
    prune(dir, Date.now())
  }
} catch {
  // not JSON, or the config dir is not writable: the wrapped status line above still stands
}

function readWrapped(key) {
  if (!key || !/^[0-9a-f]{8}$/.test(key)) return null
  try {
    const saved = JSON.parse(readFileSync(join(dir, `setup-${key}.json`), 'utf8'))
    return typeof saved.wrapped === 'string' && saved.wrapped.trim() ? saved.wrapped : null
  } catch {
    return null
  }
}

// Bridge files accumulate one per session. Drop native snapshots and half-written temps
// that nothing has touched in two hours. setup-*.json is the user's saved status line; keep it.
function prune(directory, now) {
  let names = []
  try {
    names = readdirSync(directory)
  } catch {
    return
  }
  for (const name of names) {
    if (!name.startsWith('native-') && !name.startsWith('.native-')) continue
    const path = join(directory, name)
    try {
      if (now - statSync(path).mtimeMs > STALE_MS) unlinkSync(path)
    } catch {
      // a file that vanished between readdir and stat is already gone
    }
  }
}
