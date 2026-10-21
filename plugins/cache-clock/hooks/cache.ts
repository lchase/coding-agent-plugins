export const MIN = 60000

// USD per million tokens, global standard list prices from
// https://platform.claude.com/docs/en/about-claude/pricing (checked 2026-10-18).
// No Claude Code API gives a mod per-model prices (modelPricing is managed-scope only),
// so this table stays hand-kept. Re-check it on every release.
// US-only inference is 1.1x and fast mode is a separate card; neither is applied here.
// write5 / write60 are the 5-minute (1.25x input) and 1-hour (2x input) cache-write prices.
// Sonnet 5.5 cache reads are $0.10 (0.05x), halved from $0.20 on 2026-10-07.
export type Rates = { input: number; write5: number; write60: number; read: number }

const TABLE: Record<string, Rates> = {
  'claude-fable-5-1': { input: 10, write5: 12.5, write60: 20, read: 0.25 },
  'claude-mythos-5-1': { input: 10, write5: 12.5, write60: 20, read: 0.25 },
  'claude-fable-5': { input: 10, write5: 12.5, write60: 20, read: 1 },
  'claude-mythos-5': { input: 10, write5: 12.5, write60: 20, read: 1 },
  'claude-opus-5-5': { input: 4, write5: 5, write60: 8, read: 0.2 },
  'claude-opus-5': { input: 5, write5: 6.25, write60: 10, read: 0.5 },
  'claude-opus-4-8': { input: 5, write5: 6.25, write60: 10, read: 0.5 },
  'claude-opus-4-7': { input: 5, write5: 6.25, write60: 10, read: 0.5 },
  'claude-opus-4-6': { input: 5, write5: 6.25, write60: 10, read: 0.5 },
  'claude-opus-4-5': { input: 5, write5: 6.25, write60: 10, read: 0.5 },
  // Retired on the first-party API, still listed for Bedrock / Google Cloud.
  'claude-opus-4-1': { input: 15, write5: 18.75, write60: 30, read: 1.5 },
  'claude-opus-4': { input: 15, write5: 18.75, write60: 30, read: 1.5 },
  'claude-sonnet-5-5': { input: 2, write5: 2.5, write60: 4, read: 0.1 },
  'claude-sonnet-5': { input: 2, write5: 2.5, write60: 4, read: 0.2 },
  'claude-sonnet-4-6': { input: 3, write5: 3.75, write60: 6, read: 0.3 },
  'claude-sonnet-4-5': { input: 3, write5: 3.75, write60: 6, read: 0.3 },
  'claude-sonnet-4': { input: 3, write5: 3.75, write60: 6, read: 0.3 },
  'claude-haiku-4-5': { input: 1, write5: 1.25, write60: 2, read: 0.1 },
  'claude-3-5-haiku': { input: 0.8, write5: 1, write60: 1.6, read: 0.08 },
}

// Haiku 5.5 has two rate cards chosen by prompt length: 100K tokens or fewer, or longer.
const HAIKU_55_SHORT: Rates = { input: 0.1, write5: 0.125, write60: 0.2, read: 0.01 }
const HAIKU_55_LONG: Rates = { input: 0.5, write5: 0.625, write60: 1, read: 0.05 }

// Strips a context-window suffix, a cloud-provider prefix, a Bedrock version, and a snapshot date.
// `us.anthropic.claude-sonnet-4-5-20250929-v1:0` and `claude-sonnet-4-5@20250929` both become
// `claude-sonnet-4-5`. Anything left that is not in the table stays unpriced.
export const canonical = (id: string) =>
  id
    .trim()
    .replace(/\[1m\]$/, '')
    .replace(/^(?:[a-z0-9-]+\.)?anthropic\./, '')
    .replace(/-v\d+(?::\d+)?$/, '')
    .replace(/@\d{8}$/, '')
    .replace(/-latest$/, '')
    .replace(/-\d{8}$/, '')

export function rates(model: string, promptTokens: number): Rates | null {
  const id = canonical(model)
  if (id === 'claude-haiku-5-5') return promptTokens > 100000 ? HAIKU_55_LONG : HAIKU_55_SHORT
  return TABLE[id] ?? null
}

const writeRate = (r: Rates, ttlMinutes: number) => (ttlMinutes > 5 ? r.write60 : r.write5)

// What letting the cache go cold costs EXTRA on the next turn: the write price minus the read
// price that same prefix would have cost while warm. Null when the model has no known price.
export function coldPenalty(model: string, cached: number, promptTokens: number, ttlMinutes: number): number | null {
  const r = rates(model, promptTokens)
  if (!r) return null
  return (cached * (writeRate(r, ttlMinutes) - r.read)) / 1e6
}

// What rewriting `cached` tokens into a cold cache costs, or null when the model has no known price.
export function coldCost(model: string, cached: number, promptTokens: number, ttlMinutes: number): number | null {
  const r = rates(model, promptTokens)
  if (!r) return null
  return (cached * writeRate(r, ttlMinutes)) / 1e6
}

// What the cache reads saved against paying the full input price, or null when the model has no known price.
export function savedBy(model: string, reads: number, promptTokens: number): number | null {
  const r = rates(model, promptTokens)
  if (!r) return null
  return (reads * (r.input - r.read)) / 1e6
}

export const reusedPct = (reads: number, writes: number, fresh: number) => {
  const total = reads + writes + fresh
  return total > 0 ? Math.round((reads / total) * 100) : 0
}

export const tok = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}k` : String(n)

export const usd = (n: number) => (n > 0 && n < 0.005 ? '<$0.01' : `$${n.toFixed(2)}`)

export const mins = (ms: number) => `${Math.max(1, Math.ceil(ms / MIN))}m`

export const bar = (left: number, ttl: number, cells = 6) => {
  const filled = ttl > 0 ? Math.max(0, Math.min(cells, Math.floor((left / ttl) * cells))) : 0
  return '▰'.repeat(filled) + '▱'.repeat(cells - filled)
}
