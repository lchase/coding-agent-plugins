import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const bridge = fileURLToPath(new URL('./bridge.mjs', import.meta.url))

function run(dir, stdin, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bridge, ...args], {
      env: { ...process.env, CLAUDE_CONFIG_DIR: dir, HOME: dir },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      stdout += chunk
    })
    child.stderr.on('data', chunk => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', code => resolve({ code, stdout, stderr }))
    child.stdin.end(stdin)
  })
}

test('writes prompt_cache and keeps the wrapped status line output', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cache-clock-'))
  const clock = join(dir, 'cache-clock')
  mkdirSync(clock)
  const key = 'ab12cd34'
  writeFileSync(join(clock, `setup-${key}.json`), JSON.stringify({ wrapped: 'printf wrapped' }) + '\n')
  const stdin = JSON.stringify({
    session_id: 'abc-123',
    model: { id: 'claude-sonnet-5-5' },
    prompt_cache: { warm: true, ttl: '5m', expires_at: 1700000000, hit_ratio: 0.5, misses: 1, recache_tokens_if_cold: 42 },
  })
  const { code, stdout } = await run(dir, stdin, [key])
  assert.equal(code, 0)
  assert.equal(stdout.trim(), 'wrapped')
  const saved = JSON.parse(readFileSync(join(clock, 'native-abc-123.json'), 'utf8'))
  assert.equal(saved.prompt_cache.ttl, '5m')
  assert.equal(saved.prompt_cache.recache_tokens_if_cold, 42)
  assert.equal(saved.model, 'claude-sonnet-5-5')
  assert.equal(typeof saved.writtenAt, 'number')
})

test('a session id cannot escape the directory, and snapshots older than two hours are pruned', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cache-clock-'))
  const clock = join(dir, 'cache-clock')
  mkdirSync(clock)
  const old = join(clock, 'native-old.json')
  const kept = join(clock, 'setup-ab12cd34.json')
  writeFileSync(old, '{}')
  writeFileSync(kept, '{}\n')
  const ago = new Date(Date.now() - 3 * 60 * 60 * 1000)
  utimesSync(old, ago, ago)

  const evil = await run(dir, JSON.stringify({ session_id: '../evil', prompt_cache: { warm: false } }))
  assert.equal(evil.code, 0)
  assert.equal(readdirSync(clock).some(name => name.includes('evil')), false)

  const good = await run(dir, JSON.stringify({ session_id: 'sess-1', prompt_cache: { warm: true, ttl: '5m' } }))
  assert.equal(good.code, 0)
  const names = readdirSync(clock)
  assert.equal(names.includes('native-sess-1.json'), true)
  assert.equal(names.includes('native-old.json'), false)
  assert.equal(names.includes('setup-ab12cd34.json'), true)
})
