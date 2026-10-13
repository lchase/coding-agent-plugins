import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Last, Totals } from '../types'
import { MIN, bar, coldCost, mins, reusedPct, savedBy, tok, usd } from './cache'

// all in $.state so a hot reload keeps them; lastCache is the clock's whole input
const lastCache = atom({ plugin: 'cache-clock', key: 'lastCache' } as const, 0)
const toastedFor = atom({ plugin: 'cache-clock', key: 'toastedFor' } as const, 0)
const lastStep = atom({ plugin: 'cache-clock', key: 'last' } as const, null as Last | null)
const totals = atom({ plugin: 'cache-clock', key: 'totals' } as const, { reads: 0, writes: 0, fresh: 0, saved: 0, unpricedReads: 0 } as Totals)
const isOn = atom({ plugin: 'cache-clock', key: 'isOn' } as const, true)

const CHIP_BG = '#3b2160'
const CHIP_FG = '#b8aece'
const GREEN = '#22c55e'
const AMBER = '#f59e0b'
const RED = '#ef4444'
const GREY = '#c0c0c0'
const AMBER_AT = 15 * MIN

const cost = (c: number | null) => (c === null ? '≈ ?' : `≈ ${usd(c)}`)

const coldRewrite = (last: Last, cached: number, ttlMinutes: number) =>
  coldCost(last.model, cached, last.reads + last.writes + last.fresh, ttlMinutes)

async function tick($: any, ttlMinutes: number) {
  $.ui.invalidate('ui.render')
  if (!(await read($, isOn))) return
  const at = await read($, lastCache)
  const last = await read($, lastStep)
  if (!at || !last) return
  const left = ttlMinutes * MIN - ((await $.clock.now()) - at)
  // a 5-minute cache is at 5 minutes left the moment it is written, so warn at 1 minute there
  const warnAt = ttlMinutes > 5 ? 5 * MIN : MIN
  if (left <= 0 || left > warnAt || (await read($, toastedFor)) === at) return
  await update($, toastedFor, () => at)
  const cached = last.reads + last.writes
  $.ui.toast(
    `Cache goes cold in ${mins(left)}: ${tok(cached)} tokens cached, rewrite ${cost(coldRewrite(last, cached, ttlMinutes))} (estimate). Send anything to keep it warm.`,
    { timeoutMs: 10000 },
  )
}

export const register: Register = (on, options) => {
  const ttlMinutes = options?.cacheMinutes === '5' ? 5 : 60
  const ttl = ttlMinutes * MIN

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'cache-clock', description: 'Prompt cache clock: on | off | status' })
    $.clock.every(30000, () => tick($, ttlMinutes))
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    const u = result?.usage
    if (!u) return result
    const reads = u.cache_read_input_tokens
    const writes = u.cache_creation_input_tokens
    const fresh = u.input_tokens
    const saved = savedBy(u.model, reads, reads + writes + fresh)
    // every step counts toward the session totals, subagents included
    await update($, totals, t => ({
      reads: t.reads + reads,
      writes: t.writes + writes,
      fresh: t.fresh + fresh,
      saved: t.saved + (saved ?? 0),
      unpricedReads: t.unpricedReads + (saved === null ? reads : 0),
    }))
    // only a main-loop step that touched the cache restarts the countdown
    if (!e.agentId && reads + writes > 0) {
      const at = await $.clock.now()
      await update($, lastCache, () => at)
      await update($, lastStep, () => ({ reads, writes, fresh, model: u.model }))
      $.ui.invalidate('ui.render')
    }
    return result
  })

  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    await update($, lastCache, () => 0)
    await update($, lastStep, () => null)
    return next(e)
  })

  on('command.run', { command: 'cache-clock' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'on' || arg === 'off') {
      await update($, isOn, () => arg === 'on')
      $.ui.invalidate('ui.render')
      return { text: `cache-clock ${arg}.` }
    }
    if (arg !== '' && arg !== 'status') return { text: 'Usage: /cache-clock on | off | status' }

    const [on_, at, last, t, now] = await Promise.all([read($, isOn), read($, lastCache), read($, lastStep), read($, totals), $.clock.now()])
    const left = at ? ttl - (now - at) : 0
    const lines = [`cache-clock: ${on_ ? 'on' : 'off'}, cache lifetime ${ttlMinutes}m`]
    lines.push(!at ? 'Cache: no cache activity yet' : left > 0 ? `Cache: warm, ${mins(left)} left` : 'Cache: COLD')
    lines.push(`Session reads ${tok(t.reads)}, writes ${tok(t.writes)}, fresh input ${tok(t.fresh)} (subagents included)`)
    if (last) {
      lines.push(`Reused ${reusedPct(last.reads, last.writes, last.fresh)}% on the last main step`)
      lines.push(`Cold rewrite ${cost(coldRewrite(last, last.reads + last.writes, ttlMinutes))} for ${tok(last.reads + last.writes)} cached`)
    }
    lines.push(
      `Saved ${t.unpricedReads > 0 ? 'at least ' : ''}≈ ${usd(t.saved)} by cache reads vs uncached input` +
        (t.unpricedReads > 0 ? ` (${tok(t.unpricedReads)} read tokens on models with no known price)` : ''),
    )
    lines.push('Dollar figures are estimates from list prices.')
    return { text: lines.join('\n') }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const [active, at, last] = await Promise.all([read($, isOn), read($, lastCache), read($, lastStep)])
    if (e.props.hasSurvey || !active || !at || !last) return next(e)

    // keep every other mod's lines: ours goes on top, theirs stay beneath
    let below: Awaited<ReturnType<typeof next>> | undefined
    try {
      below = await next(e)
    } catch {
      below = undefined
    }

    const { Box, Text, Button } = $.ui.resolve(e)
    const left = ttl - ((await $.clock.now()) - at)
    const color = left <= 0 ? RED : left <= AMBER_AT ? AMBER : GREEN
    const cached = last.reads + last.writes
    const compact = async () => {
      try {
        const r = await $.session.compact()
        $.ui.toast(
          r.skip
            ? `Compact skipped: ${r.skip}`
            : r.tokensBefore !== undefined && r.tokensAfter !== undefined
              ? `Compacted: ${tok(r.tokensBefore)} to ${tok(r.tokensAfter)} tokens.`
              : 'Compacted.',
        )
      } catch (err) {
        $.ui.toast(`Compact failed: ${String((err as Error)?.message ?? err).slice(0, 100)}`)
      }
    }

    const line = (
      <Box>
        <Text bold color={CHIP_FG} backgroundColor={CHIP_BG}>
          {'  ● CACHE  '}
        </Text>
        <Text bold color={color}>
          {left > 0 ? ` warm ${mins(left)} ` : ' COLD '}
        </Text>
        <Text color={color}>{bar(left, ttl)}</Text>
        <Text color={GREY}>
          {` ${reusedPct(last.reads, last.writes, last.fresh)}% reused · ${tok(cached)} cached · cold rewrite ${cost(coldRewrite(last, cached, ttlMinutes))} `}
        </Text>
        <Button key="compact" label="Compact" onPress={compact} />
      </Box>
    )
    if (!below) return line
    return (
      <Box flexDirection="column">
        {line}
        {below}
      </Box>
    )
  })
}
