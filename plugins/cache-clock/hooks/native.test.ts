import { expect, test } from 'claude-code/testing'

import { claudeConfigDir, isOlderThan, leftMs, parseBridge, pickTtl } from './native'

const T0 = 1_000_000_000_000

test('TTL precedence follows Claude Code: force, env, setting, enable, then the guess', () => {
  const base = { fallbackMinutes: 5 }
  expect(pickTtl({ ...base, force5m: '1', envTtl: '1h', promptCacheTtl: '1h', enable1h: '1' })).toEqual({ minutes: 5, source: 'env' })
  expect(pickTtl({ ...base, fileForce5m: '1', promptCacheTtl: '1h' })).toEqual({ minutes: 5, source: 'env' })
  expect(pickTtl({ ...base, envTtl: '1h', promptCacheTtl: '5m' })).toEqual({ minutes: 60, source: 'env' })
  expect(pickTtl({ ...base, fileEnvTtl: '5m', promptCacheTtl: '1h' })).toEqual({ minutes: 5, source: 'env' })
  expect(pickTtl({ ...base, envTtl: '2h', promptCacheTtl: '1h' })).toEqual({ minutes: 60, source: 'settings' })
  expect(pickTtl({ ...base, enable1h: '1' })).toEqual({ minutes: 60, source: 'env' })
  expect(pickTtl({ ...base, fileEnable1h: '1' })).toEqual({ minutes: 60, source: 'env' })
  expect(pickTtl(base)).toEqual({ minutes: 5, source: 'assumed' })
  expect(pickTtl({ ...base, fallbackMinutes: 60 })).toEqual({ minutes: 60, source: 'assumed' })
})

test('a bridge file is ignored when stale, pre-compaction, or missing prompt_cache', () => {
  const fresh = JSON.stringify({
    writtenAt: T0,
    model: 'claude-sonnet-5-5',
    prompt_cache: { warm: true, ttl: '1h', expires_at: 50, hit_ratio: 0.91, misses: 2, recache_tokens_if_cold: 180000 },
  })
  const got = parseBridge(fresh, T0, 0)
  expect(got?.cache.ttl).toBe('1h')
  expect(got?.cache.recache_tokens_if_cold).toBe(180000)
  expect(got?.model).toBe('claude-sonnet-5-5')

  expect(parseBridge(fresh, T0 + 3 * 60 * 60 * 1000, 0)).toBe(null)
  expect(parseBridge(fresh, T0, T0 + 1)).toBe(null)
  expect(parseBridge('not json', T0, 0)).toBe(null)
  expect(parseBridge(JSON.stringify({ writtenAt: T0, prompt_cache: null }), T0, 0)).toBe(null)

  const pending = parseBridge(JSON.stringify({ writtenAt: T0, prompt_cache: { warm: false, ttl: '5m', expires_at: null, recache_tokens_if_cold: null } }), T0, 0)
  expect(pending?.cache.recache_tokens_if_cold).toBe(null)
  const absent = parseBridge(JSON.stringify({ writtenAt: T0, prompt_cache: { warm: true, ttl: '5m' } }), T0, 0)
  expect(absent?.cache.recache_tokens_if_cold).toBe(undefined)
})

test('time left prefers expires_at, then a cold flag, then the request-start stamp', () => {
  expect(leftMs({ expires_at: (T0 + 40 * 60000) / 1000 }, 0, 60, T0)).toBe(40 * 60000)
  expect(leftMs({ warm: false, expires_at: null }, T0, 60, T0)).toBe(0)
  expect(leftMs(null, T0, 5, T0 + 2 * 60000)).toBe(3 * 60000)
  expect(leftMs(null, 0, 5, T0)).toBe(0)
})

test('version gate is 2.1.251 and the config dir honours CLAUDE_CONFIG_DIR', () => {
  expect(isOlderThan('2.1.250', [2, 1, 251])).toBe(true)
  expect(isOlderThan('2.1.251', [2, 1, 251])).toBe(false)
  expect(isOlderThan('2.1.251-beta', [2, 1, 251])).toBe(false)
  expect(isOlderThan('2.2.0', [2, 1, 251])).toBe(false)
  expect(isOlderThan('', [2, 1, 251])).toBe(false)
  expect(claudeConfigDir('/tmp/claude/', '/home/t')).toBe('/tmp/claude')
  expect(claudeConfigDir(undefined, '/home/t/')).toBe('/home/t/.claude')
  expect(claudeConfigDir('', '')).toBe(null)
})
