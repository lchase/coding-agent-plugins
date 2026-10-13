import type { Limit, Reading } from '../types'

export const GREEN = '#4ade80'
export const AMBER = '#fbbf24'
export const RED = '#f87171'
export const CHIP_BG = '#3b2160'
export const CHIP_FG = '#b8aece'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MIN = 60_000
const PACE_MIN_SPAN = 4.5 * MIN
const PACE_KEEP = 30 * MIN

export function colorFor(pct: number): string {
  if (pct > 85) return RED
  if (pct >= 60) return AMBER
  return GREEN
}

export function bar(pct: number, cells: number): string {
  const filled = Math.max(0, Math.min(cells, Math.round((pct / 100) * cells)))
  return '▰'.repeat(filled) + '▱'.repeat(cells - filled)
}

export function windowLabel(kind: string): string {
  if (kind === 'five_hour') return '5h'
  if (kind === 'seven_day') return 'week'
  return kind
}

export function windowTitle(kind: string): string {
  if (kind === 'five_hour') return '5-hour limit'
  if (kind === 'seven_day') return 'Weekly limit'
  return `${kind} limit`
}

export function shortLabel(kind: string): string {
  if (kind === 'five_hour') return '5h'
  if (kind === 'seven_day') return 'wk'
  return kind
}

export function pctText(pct: number): string {
  return `${Math.round(pct)}%`
}

export function duration(ms: number): string {
  const total = Math.max(0, Math.round(ms / MIN))
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h === 0) return `${m}m`
  return `${h}h${String(m).padStart(2, '0')}m`
}

function clock(date: Date): string {
  const h = date.getHours()
  const m = date.getMinutes()
  const h12 = h % 12 === 0 ? 12 : h % 12
  const suffix = h < 12 ? 'am' : 'pm'
  return m === 0 ? `${h12}${suffix}` : `${h12}:${String(m).padStart(2, '0')}${suffix}`
}

/** `2h11m` within a day, otherwise `Thu 9am`; undefined when there is no reset time. */
export function resetText(limit: Limit, now: number): string | undefined {
  if (!limit.resetsAt) return undefined
  const at = Date.parse(limit.resetsAt)
  if (Number.isNaN(at)) return undefined
  const left = at - now
  if (left <= 0) return 'now'
  if (left < 24 * 60 * MIN) return duration(left)
  const date = new Date(at)
  return `${DAYS[date.getDay()]} ${clock(date)}`
}

export function money(usd: number): string {
  return `$${usd.toFixed(2)}`
}

/** Append a reading; a drop in percent means the window reset, so history restarts. */
export function addReading(list: Reading[] | undefined, pct: number, t: number): Reading[] {
  const prior = list ?? []
  const last = prior[prior.length - 1]
  const base = last && pct < last.pct ? [] : prior
  const tail = base[base.length - 1]
  if (tail && tail.pct === pct) return base
  return [...base, { pct, t }].filter(r => t - r.t <= PACE_KEEP).slice(-20)
}

/**
 * Minutes until the window runs out at the rate the readings show, when that is
 * before it resets. Needs two readings about five minutes apart.
 */
export function paceOutMs(
  readings: Reading[] | undefined,
  resetsAt: string | undefined,
  now: number,
): number | undefined {
  if (!readings || readings.length < 2 || !resetsAt) return undefined
  const first = readings[0]!
  const last = readings[readings.length - 1]!
  const span = last.t - first.t
  const gain = last.pct - first.pct
  if (span < PACE_MIN_SPAN || gain <= 0 || last.pct >= 100) return undefined
  const rate = gain / span
  const runOut = last.t + (100 - last.pct) / rate
  const reset = Date.parse(resetsAt)
  if (Number.isNaN(reset) || runOut >= reset) return undefined
  return Math.max(MIN, runOut - now)
}

export function paceText(outMs: number): string {
  const mins = Math.max(1, Math.round(outMs / MIN))
  if (mins < 60) return `~${mins}m`
  return `~${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}m`
}

export function parseWarn(args: string): { a: number; b: number } | string {
  const parts = args.trim().split(/\s+/).slice(1)
  const [a, b] = parts.map(Number)
  const ok = (n: number | undefined): n is number =>
    n !== undefined && Number.isFinite(n) && n > 0 && n <= 100
  if (parts.length !== 2 || !ok(a) || !ok(b)) return 'Usage: /usage-gauge warn <a> <b> (percent, e.g. 75 90)'
  if (a >= b) return 'The first threshold must be below the second.'
  return { a, b }
}
