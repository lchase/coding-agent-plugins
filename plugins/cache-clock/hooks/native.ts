import { MIN } from './cache'

// Facts the band can know, best source first:
//   1. Claude Code's prompt_cache (status line stdin, bridged by statusline/bridge.mjs).
//      TTL, expiry, warm, hit ratio, misses, miss cause, re-cache size. Main conversation only.
//   2. The TTL the user chose: FORCE_PROMPT_CACHING_5M, CLAUDE_CODE_PROMPT_CACHE_TTL,
//      settings promptCacheTtl, ENABLE_PROMPT_CACHING_1H. Blind to the subscription-vs-API
//      default and to a mid-session drop onto usage credits.
//   3. The plugin's cacheMinutes option. A guess. The band marks it with "?".
// Docs: https://code.claude.com/docs/en/statusline#prompt-cache-fields
//       https://code.claude.com/docs/en/prompt-caching#choose-the-ttl-yourself

export type NativeCache = {
  warm?: boolean
  caching_observed?: boolean
  ttl?: '5m' | '1h'
  expires_at?: number | null // epoch seconds
  hit_ratio?: number | null
  misses?: number
  last_miss_cause?: { causes: string[] } | null
  // undefined: the field was absent (fall back to the last step). null: Claude Code
  // says the size is not known yet (right after compaction or tool-result clearing).
  recache_tokens_if_cold?: number | null
}

export type Bridge = { cache: NativeCache; model: string | null; writtenAt: number }

export type TtlSource = 'native' | 'env' | 'settings' | 'assumed'

export type TtlPick = { minutes: number; source: TtlSource }

export type TtlInput = {
  force5m?: string
  envTtl?: string
  fileForce5m?: string
  fileEnvTtl?: string
  promptCacheTtl?: string
  enable1h?: string
  fileEnable1h?: string
  fallbackMinutes: number
}

// Ignore a bridge file nobody has refreshed in 2 hours (old session, bridge removed).
export const STALE_MS = 2 * 60 * MIN

export const asMinutes = (v: unknown): 5 | 60 | null => (v === '1h' ? 60 : v === '5m' ? 5 : null)

export function claudeConfigDir(custom: string | undefined, home: string | undefined): string | null {
  const picked = custom?.trim().replace(/\/+$/, '')
  if (picked) return picked
  const root = home?.trim().replace(/\/+$/, '')
  return root ? `${root}/.claude` : null
}

export const bridgeDirectory = (config: string) => `${config}/cache-clock`

// Session ids are UUIDs. Reject anything else so a bridge filename cannot escape the directory.
export function nativeFile(dir: string, sessionId: string): string | null {
  if (!/^[\w-]+$/.test(sessionId)) return null
  return `${dir}/native-${sessionId}.json`
}

const asBool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined)

const asCause = (v: unknown): { causes: string[] } | null => {
  if (!v || typeof v !== 'object') return null
  const raw = (v as { causes?: unknown }).causes
  if (!Array.isArray(raw)) return null
  const causes = raw.filter((c): c is string => typeof c === 'string' && c.length > 0)
  return causes.length ? { causes } : null
}

export function asCache(v: unknown): NativeCache | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  const ttl = o.ttl === '5m' || o.ttl === '1h' ? o.ttl : undefined
  const expires = typeof o.expires_at === 'number' ? o.expires_at : o.expires_at === null ? null : undefined
  const hit = typeof o.hit_ratio === 'number' ? o.hit_ratio : o.hit_ratio === null ? null : undefined
  const misses = typeof o.misses === 'number' ? o.misses : undefined
  let recache: number | null | undefined
  if ('recache_tokens_if_cold' in o) {
    recache = typeof o.recache_tokens_if_cold === 'number' ? o.recache_tokens_if_cold : null
  }
  return {
    warm: asBool(o.warm),
    caching_observed: asBool(o.caching_observed),
    ttl,
    expires_at: expires,
    hit_ratio: hit,
    misses,
    last_miss_cause: asCause(o.last_miss_cause),
    recache_tokens_if_cold: recache,
  }
}

// prompt_cache for this session as the status line last wrote it, or null when missing or stale.
export function parseBridge(text: string | null, now: number, floor: number): Bridge | null {
  if (!text) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const rec = parsed as { writtenAt?: unknown; prompt_cache?: unknown; model?: unknown }
  const writtenAt = typeof rec.writtenAt === 'number' ? rec.writtenAt : 0
  if (writtenAt < floor || now - writtenAt > STALE_MS) return null
  const cache = asCache(rec.prompt_cache)
  if (!cache) return null
  return { cache, model: typeof rec.model === 'string' ? rec.model : null, writtenAt }
}

// The user-chosen main-conversation TTL, in Claude Code's precedence, or the fallback guess.
// https://code.claude.com/docs/en/prompt-caching#choose-the-ttl-yourself
export function pickTtl(input: TtlInput): TtlPick {
  const force = input.force5m === '1' || input.fileForce5m === '1'
  if (force) return { minutes: 5, source: 'env' }
  const env = asMinutes(input.envTtl) ?? asMinutes(input.fileEnvTtl)
  if (env) return { minutes: env, source: 'env' }
  const setting = asMinutes(input.promptCacheTtl)
  if (setting) return { minutes: setting, source: 'settings' }
  if (input.enable1h === '1' || input.fileEnable1h === '1') return { minutes: 60, source: 'env' }
  return { minutes: input.fallbackMinutes, source: 'assumed' }
}

export function envBlock(settings: unknown): Record<string, unknown> {
  if (!settings || typeof settings !== 'object') return {}
  const env = (settings as { env?: unknown }).env
  if (!env || typeof env !== 'object' || Array.isArray(env)) return {}
  return env as Record<string, unknown>
}

export const str = (obj: Record<string, unknown>, key: string): string | undefined =>
  typeof obj[key] === 'string' ? (obj[key] as string) : undefined

// Milliseconds of warmth left. Native expires_at when we have it (Claude Code already
// measured from the request start). Otherwise the stamp taken before the request went out.
export function leftMs(native: NativeCache | null, stampedAt: number, ttlMinutes: number, now: number): number {
  if (native && typeof native.expires_at === 'number') return native.expires_at * 1000 - now
  if (native && native.warm === false) return 0
  if (!stampedAt) return 0
  return ttlMinutes * MIN - (now - stampedAt)
}

export const causeLabel = (causes: string[] | undefined): string | undefined =>
  causes && causes.length > 0 ? causes.join(', ').replaceAll('_', ' ') : undefined

// `base` is the semver Claude Code reports (2.1.302). `version` is the same string on
// current builds. An unparsable value does not block setup.
export function isOlderThan(version: string, min: readonly number[]): boolean {
  const parts = version.split(/[.-]/).slice(0, min.length).map(Number)
  if (parts.length < min.length || parts.some(n => Number.isNaN(n))) return false
  for (let i = 0; i < min.length; i++) {
    const part = parts[i] ?? 0
    const want = min[i] ?? 0
    if (part !== want) return part < want
  }
  return false
}

export function versionText(value: unknown): string {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return ''
  const o = value as { base?: unknown; version?: unknown }
  if (typeof o.base === 'string' && o.base) return o.base
  if (typeof o.version === 'string') return o.version
  return ''
}
