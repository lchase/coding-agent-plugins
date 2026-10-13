export const MIN = 60000

// USD per million tokens, copied from the claude-api skill's model table (cached 2026-10-06).
// write5 / write60 are the 5-minute (1.25x input) and 1-hour (2x input) cache-write prices.
export type Rates = { input: number; write5: number; write60: number; read: number }

const TABLE: Record<string, Rates> = {
  'claude-fable-5-1': { input: 10, write5: 12.5, write60: 20, read: 0.25 },
  'claude-mythos-5-1': { input: 10, write5: 12.5, write60: 20, read: 0.25 },
  'claude-fable-5': { input: 10, write5: 12.5, write60: 20, read: 1 },
  'claude-opus-5-5': { input: 4, write5: 5, write60: 8, read: 0.2 },
  'claude-opus-5': { input: 5, write5: 6.25, write60: 10, read: 0.5 },
  'claude-opus-4-8': { input: 5, write5: 6.25, write60: 10, read: 0.5 },
  'claude-opus-4-7': { input: 5, write5: 6.25, write60: 10, read: 0.5 },
  'claude-opus-4-6': { input: 5, write5: 6.25, write60: 10, read: 0.5 },
  'claude-sonnet-5-5': { input: 2, write5: 2.5, write60: 4, read: 0.2 },
  'claude-sonnet-5': { input: 2, write5: 2.5, write60: 4, read: 0.2 },
  'claude-sonnet-4-6': { input: 3, write5: 3.75, write60: 6, read: 0.3 },
  'claude-haiku-4-5': { input: 1, write5: 1.25, write60: 2, read: 0.1 },
}

// Haiku 5.5 has two rate cards chosen by prompt length: 100K tokens or fewer, or longer.
const HAIKU_55_SHORT: Rates = { input: 0.1, write5: 0.125, write60: 0.2, read: 0.01 }
const HAIKU_55_LONG: Rates = { input: 0.5, write5: 0.625, write60: 1, read: 0.05 }

// strips "[1m]", a date suffix and a cloud-provider prefix; anything not in the table stays unknown
export const canonical = (id: string) =>
  id
    .replace(/\[1m\]$/, '')
    .replace(/^(?:[a-z]{2}\.)?anthropic\./, '')
    .replace(/-\d{8}$/, '')

export function rates(model: string, promptTokens: number): Rates | null {
  const id = canonical(model)
  if (id === 'claude-haiku-5-5') return promptTokens > 100000 ? HAIKU_55_LONG : HAIKU_55_SHORT
  return TABLE[id] ?? null
}

// what rewriting `cached` tokens into a cold cache costs, or null when the model has no known price
export function coldCost(model: string, cached: number, promptTokens: number, ttlMinutes: number): number | null {
  const r = rates(model, promptTokens)
  if (!r) return null
  return (cached * (ttlMinutes > 5 ? r.write60 : r.write5)) / 1e6
}

// what the cache reads saved against paying the full input price, or null when the model has no known price
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
  const filled = Math.max(0, Math.min(cells, Math.floor((left / ttl) * cells)))
  return '▰'.repeat(filled) + '▱'.repeat(cells - filled)
}
