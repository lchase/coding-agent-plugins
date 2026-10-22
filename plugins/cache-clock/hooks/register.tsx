import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Last, Totals } from '../types'
import { MIN, bar, coldCost, coldPenalty, mins, reusedPct, savedBy, tok, usd } from './cache'
import {
  bridgeDirectory,
  causeLabel,
  claudeConfigDir,
  envBlock,
  isOlderThan,
  leftMs,
  nativeFile,
  parseBridge,
  pickTtl,
  str,
  versionText,
} from './native'
import type { NativeCache, TtlSource } from './native'

// lastCache is the fallback clock only: milliseconds when the request STARTED.
// Native expires_at wins whenever the status-line bridge has written one.
// nativeAfter ignores bridge files written before the last compaction or new conversation.
const lastCache = atom({ plugin: 'cache-clock', key: 'lastCache' } as const, 0)
const toastedFor = atom({ plugin: 'cache-clock', key: 'toastedFor' } as const, 0)
const lastStep = atom({ plugin: 'cache-clock', key: 'last' } as const, null as Last | null)
const totals = atom({ plugin: 'cache-clock', key: 'totals' } as const, { reads: 0, writes: 0, fresh: 0, saved: 0, unpricedReads: 0 } as Totals)
const isOn = atom({ plugin: 'cache-clock', key: 'isOn' } as const, true)
const nativeAfter = atom({ plugin: 'cache-clock', key: 'nativeAfter' } as const, 0)

// 7 cells, the length of 'handoff', so stacked bands line up
const LABEL_W = 7
const GREEN = '#22c55e'
const AMBER = '#f59e0b'
const RED = '#ef4444'
const BRIDGE = 'cache-clock/bridge.mjs'
const MIN_VERSION = [2, 1, 251] as const // first Claude Code that sends prompt_cache to the status line

// The loader cancels timers when this module reloads (mods API: "Timers stop when the module
// reloads"). session.start then fires again. This flag lives on the module, so a reload resets
// it and the new module arms one timer. A $.state flag would survive the reload and skip that.
let clockOn = false

const cost = (c: number | null) => (c === null ? '≈ ?' : `≈ ${usd(c)}`)

type View = {
  left: number
  ttlMinutes: number
  source: TtlSource
  cached: number | null
  native: NativeCache | null
  model: string | null
  last: Last | null
}

const tokensOf = (v: View) => (v.last ? v.last.reads + v.last.writes + v.last.fresh : (v.cached ?? 0))

const penalty = (v: View) => (v.model && v.cached !== null ? coldPenalty(v.model, v.cached, tokensOf(v), v.ttlMinutes) : null)

const rewrite = (v: View) => (v.model && v.cached !== null ? coldCost(v.model, v.cached, tokensOf(v), v.ttlMinutes) : null)

async function configOf($: EngineInterface): Promise<string | null> {
  return claudeConfigDir(await $.env.get('CLAUDE_CONFIG_DIR'), await $.env.get('HOME'))
}

async function readNative($: EngineInterface, now: number, floor: number) {
  const config = await configOf($)
  if (!config) return null
  const id = await $.session.id()
  const file = nativeFile(bridgeDirectory(config), String(id ?? ''))
  if (!file) return null
  const text = await $.fs.read(file).catch(() => null)
  return parseBridge(typeof text === 'string' ? text : null, now, floor)
}

async function chosen($: EngineInterface, fallbackMinutes: number) {
  const settings = await $.settings.read().catch(() => ({}))
  const env = envBlock(settings)
  const prompt = settings && typeof settings === 'object' ? (settings as { promptCacheTtl?: unknown }).promptCacheTtl : undefined
  return pickTtl({
    force5m: await $.env.get('FORCE_PROMPT_CACHING_5M'),
    envTtl: await $.env.get('CLAUDE_CODE_PROMPT_CACHE_TTL'),
    enable1h: await $.env.get('ENABLE_PROMPT_CACHING_1H'),
    fileForce5m: str(env, 'FORCE_PROMPT_CACHING_5M'),
    fileEnvTtl: str(env, 'CLAUDE_CODE_PROMPT_CACHE_TTL'),
    fileEnable1h: str(env, 'ENABLE_PROMPT_CACHING_1H'),
    promptCacheTtl: typeof prompt === 'string' ? prompt : undefined,
    fallbackMinutes,
  })
}

async function view($: EngineInterface, fallbackMinutes: number): Promise<View | null> {
  const [at, last, floor, now] = await Promise.all([read($, lastCache), read($, lastStep), read($, nativeAfter), $.clock.now()])
  const bridge = await readNative($, now, floor)
  const native = bridge?.cache ?? null
  if (!native && (!at || !last)) return null
  const picked = native?.ttl ? { minutes: native.ttl === '1h' ? 60 : 5, source: 'native' as const } : await chosen($, fallbackMinutes)
  const cached = native && native.recache_tokens_if_cold !== undefined ? native.recache_tokens_if_cold : last ? last.reads + last.writes : null
  return {
    left: leftMs(native, at, picked.minutes, now),
    ttlMinutes: picked.minutes,
    source: picked.source,
    cached,
    native,
    model: last?.model ?? bridge?.model ?? null,
    last,
  }
}

async function tick($: EngineInterface, fallbackMinutes: number) {
  $.ui.invalidate('ui.render')
  if (!(await read($, isOn))) return
  const v = await view($, fallbackMinutes)
  if (!v) return
  const key = v.native?.expires_at ?? (await read($, lastCache))
  // a 5-minute cache is at 5 minutes left the moment it is written, so warn at 1 minute there
  const warnAt = v.ttlMinutes > 5 ? 5 * MIN : MIN
  if (v.left <= 0 || v.left > warnAt || (await read($, toastedFor)) === key) return
  await update($, toastedFor, () => key)
  const size = v.cached === null ? 'size pending' : `${tok(v.cached)} tokens cached`
  $.ui.toast(
    `Cache goes cold in ${mins(v.left)}: ${size}, going cold costs ${cost(penalty(v))} extra (estimate). Send anything to keep it warm.`,
    { timeoutMs: 10000 },
  )
}

async function reset($: EngineInterface) {
  const now = await $.clock.now()
  await update($, lastCache, () => 0)
  await update($, lastStep, () => null)
  await update($, toastedFor, () => 0)
  await update($, nativeAfter, () => now)
}

const ttlLine = (v: View) => {
  if (v.source === 'native') return `TTL ${v.ttlMinutes}m (from Claude Code's prompt_cache)`
  if (v.source === 'settings') return `TTL ${v.ttlMinutes}m (from your promptCacheTtl setting)`
  if (v.source === 'env') return `TTL ${v.ttlMinutes}m (from your prompt-cache environment)`
  return `TTL ${v.ttlMinutes}m (ASSUMED from the cacheMinutes option; /cache-clock setup reads Claude Code's prompt_cache)`
}

const bandDetail = (v: View) => {
  const parts: string[] = []
  if (typeof v.native?.hit_ratio === 'number') parts.push(`${Math.round(v.native.hit_ratio * 100)}% hit`)
  else if (v.last) parts.push(`${reusedPct(v.last.reads, v.last.writes, v.last.fresh)}% reused`)
  parts.push(v.cached === null ? 'size pending' : `${tok(v.cached)} cached`)
  parts.push(`cold costs ${cost(penalty(v))} extra`)
  if (v.left <= 0) {
    const cause = v.native?.last_miss_cause?.causes[0]?.replaceAll('_', ' ')
    if (cause) parts.push(cause)
  }
  return ` ${parts.join(' · ')} `
}

export const register: Register = (on, options) => {
  // 5 when we must guess: a 60-minute guess shows "warm" on a cache that died at 5.
  const fallbackMinutes = options?.cacheMinutes === '60' ? 60 : 5

  on('session.start', async ($, e, next) => {
    if (!clockOn) {
      clockOn = true
      $.clock.every(30000, () => tick($, fallbackMinutes))
    }
    await refreshBridge($).catch(() => {})
    await $.command
      .register({
        name: 'cache-clock',
        description: 'Prompt cache clock: on | off | status | setup | remove',
        argumentHint: '[on|off|status|setup|remove]',
      })
      .catch(() => {})
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    // The API measures TTL from the start of the request, not from the end of the response.
    const startedAt = e.agentId ? 0 : await $.clock.now()
    const result = yield* next(e)
    const u = result?.usage
    if (!u) return result
    const reads = u.cache_read_input_tokens
    const writes = u.cache_creation_input_tokens
    const fresh = u.input_tokens
    const saved = savedBy(u.model, reads, reads + writes + fresh)
    await update($, totals, t => ({
      reads: t.reads + reads,
      writes: t.writes + writes,
      fresh: t.fresh + fresh,
      saved: t.saved + (saved ?? 0),
      unpricedReads: t.unpricedReads + (saved === null ? reads : 0),
    }))
    // only a main-loop step that touched the cache restarts the fallback countdown
    if (!e.agentId && reads + writes > 0) {
      await update($, lastCache, () => startedAt)
      await update($, lastStep, () => ({ reads, writes, fresh, model: u.model }))
      $.ui.invalidate('ui.render')
    }
    return result
  })

  // /compact is about to drop the old prefix. Clear derived state before it runs.
  // A compact this mod starts itself is a re-entry, so this hook is skipped and the button resets.
  on('session.compact', async ($, e, next) => {
    await reset($)
    return next(e)
  }).catch(passOn)

  // A new conversation, or the SessionStart that follows compaction. `compact` is a documented source.
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork', 'compact'] }, async ($, e, next) => {
    await reset($)
    return next(e)
  }).catch(passOn)

  on('command.run', { command: 'cache-clock' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'on' || arg === 'off') {
      await update($, isOn, () => arg === 'on')
      $.ui.invalidate('ui.render')
      return { text: `cache-clock ${arg}.` }
    }
    if (arg === 'setup' || arg === 'remove') {
      try {
        return { text: arg === 'setup' ? await setup($) : await remove($) }
      } catch (err) {
        return { text: `cache-clock ${arg} failed: ${String((err as Error)?.message ?? err).slice(0, 200)}` }
      }
    }
    if (arg !== '' && arg !== 'status') return { text: 'Usage: /cache-clock on | off | status | setup | remove' }

    const [on_, t] = await Promise.all([read($, isOn), read($, totals)])
    const v = await view($, fallbackMinutes)
    const lines = [`cache-clock: ${on_ ? 'on' : 'off'}`]
    if (!v) lines.push('Cache: no cache activity yet')
    else {
      lines.push(ttlLine(v))
      lines.push(v.left > 0 ? `Cache: warm, ${mins(v.left)} left` : 'Cache: COLD')
      if (typeof v.native?.hit_ratio === 'number') {
        lines.push(`Claude Code: ${Math.round(v.native.hit_ratio * 100)}% of input from cache, ${v.native.misses ?? 0} misses`)
      } else if (v.last) {
        lines.push(`Reused ${reusedPct(v.last.reads, v.last.writes, v.last.fresh)}% on the last main step`)
      }
      const causes = causeLabel(v.native?.last_miss_cause?.causes)
      if (causes) lines.push(`Last miss: ${causes}`)
      const size = v.cached === null ? 'size pending' : `${tok(v.cached)} cached`
      lines.push(`Going cold costs ${cost(penalty(v))} extra for ${size} (full rewrite ${cost(rewrite(v))})`)
    }
    lines.push(`Session reads ${tok(t.reads)}, writes ${tok(t.writes)}, fresh input ${tok(t.fresh)} (subagents included)`)
    lines.push(
      `Saved ${t.unpricedReads > 0 ? 'at least ' : ''}≈ ${usd(t.saved)} by cache reads vs uncached input` +
        (t.unpricedReads > 0 ? ` (${tok(t.unpricedReads)} read tokens on models with no known price)` : ''),
    )
    lines.push('Dollar figures are estimates from list prices. A "?" on the band means the TTL is assumed, not reported by Claude Code.')
    return { text: lines.join('\n') }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const active = await read($, isOn)
    if (e.props.hasSurvey || !active) return next(e)
    const v = await view($, fallbackMinutes)
    if (!v) return next(e)

    let below: Awaited<ReturnType<typeof next>> | undefined
    try {
      below = await next(e)
    } catch {
      below = undefined
    }

    const { Box, Text, Button } = $.ui.resolve(e)
    const ttl = v.ttlMinutes * MIN
    const color = v.left <= 0 ? RED : v.left <= ttl / 4 ? AMBER : GREEN
    const mark = v.source === 'assumed' ? '?' : ''
    const compact = async () => {
      try {
        const r = await $.session.compact()
        // This call re-enters session.compact, so the hook above is skipped. Reset here.
        if (!r.skip) await reset($)
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

    // proportional fonts collapse the padded label, │ and ▰▱ cells: a gapped row with an Svg meter
    const desktop = () => {
      if (e.surface === 'terminal') return null
      const { Svg } = $.ui.resolve(e)
      const fill = Math.round(Math.max(0, Math.min(1, v.left / ttl)) * 56)
      return (
        <Box flexDirection="row" alignItems="center" flexWrap="wrap" gap={1}>
          <Text dimColor bold>cache</Text>
          <Text bold color={color}>{v.left > 0 ? `warm ${mins(v.left)}${mark}` : 'COLD'}</Text>
          <Svg
            source={`<svg xmlns="http://www.w3.org/2000/svg" width="56" height="8" viewBox="0 0 56 8"><rect width="56" height="8" rx="4" fill="#8080804d"/><rect width="${fill}" height="8" rx="4" fill="${color}"/></svg>`}
            alt={v.left > 0 ? `${mins(v.left)} left` : 'cold'}
            width={56}
            height={8}
          />
          <Text dimColor>{bandDetail(v).trim()}</Text>
          {v.left > 0 ? <Button key="compact" label="Compact" onPress={compact} /> : null}
        </Box>
      )
    }

    // filled cells in the state color, empty cells dim
    const cells = bar(v.left, ttl)
    const line = desktop() ?? (
      <Box>
        <Text dimColor>{'cache'.padStart(LABEL_W)}</Text>
        <Text dimColor>{' │ '}</Text>
        <Text bold color={color}>
          {v.left > 0 ? `warm ${mins(v.left)}${mark} ` : 'COLD '}
        </Text>
        <Text color={color}>{cells.replace(/▱/g, '')}</Text>
        <Text dimColor>{cells.replace(/▰/g, '')}</Text>
        <Text dimColor>{bandDetail(v)}</Text>
        {/* Compacting a cold cache re-reads the history uncached. Offer it only while warm. */}
        {v.left > 0 ? <Button key="compact" plain label="[ Compact ]" onPress={compact} /> : null}
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

// A throw in reset must not block compaction or a new conversation. Re-entry (the Compact
// button calling $.session.compact) skips the hook; calling next again would compact twice.
async function passOn(_$: EngineInterface, e: unknown, next: ((event: unknown) => Promise<unknown>) & { called?: boolean; error?: { kind?: string } }) {
  if (next.error?.kind === 're-entry' || next.called) return
  return next(e)
}

// ---- /cache-clock setup | remove -------------------------------------------------------
// Plugins cannot ship a statusLine. Setup edits the user settings file only, saves the
// previous command, and points statusLine at statusline/bridge.mjs. A status line that
// comes from managed settings, --settings, or project/local settings is reported and left alone.

type StatusLine = { type?: string; command?: string; [key: string]: unknown }

function asStatusLine(value: unknown): StatusLine | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as StatusLine) : null
}

function fnv(s: string) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0
  return h.toString(16).padStart(8, '0')
}

function shellQuoted(path: string) {
  return path.replace(/["\\$`]/g, c => `\\${c}`)
}

async function readJson($: EngineInterface, file: string): Promise<Record<string, unknown>> {
  if (!(await $.fs.exists(file))) return {}
  const text = await $.fs.read(file)
  if (!text.trim()) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`${file} is not valid JSON, so it was left as it is.`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${file} does not hold a settings object.`)
  return parsed as Record<string, unknown>
}

async function copyBridge($: EngineInterface, dir: string) {
  await $.fs.write(`${dir}/bridge.mjs`, await $.fs.read(`${$.plugin.root}/statusline/bridge.mjs`))
}

async function refreshBridge($: EngineInterface) {
  const settings = await $.settings.read({ source: 'user' }).catch(() => null)
  const command = asStatusLine((settings as { statusLine?: unknown } | null)?.statusLine)?.command
  if (typeof command !== 'string' || !command.includes(BRIDGE)) return
  const config = await configOf($)
  if (!config) return
  const dir = bridgeDirectory(config)
  const fresh = await $.fs.read(`${$.plugin.root}/statusline/bridge.mjs`)
  const copy = await $.fs.read(`${dir}/bridge.mjs`).catch(() => null)
  if (copy !== fresh) await $.fs.write(`${dir}/bridge.mjs`, fresh)
}

async function higherStatusLine($: EngineInterface): Promise<string | null> {
  for (const source of ['policy', 'flag', 'local', 'project'] as const) {
    const settings = await $.settings.read({ source }).catch(() => ({}))
    if (asStatusLine((settings as { statusLine?: unknown })?.statusLine)) return source
  }
  return null
}

async function nodeWarning($: EngineInterface): Promise<string> {
  const node = await $.process.run(['node', '--version'], { timeoutMs: 5000 }).catch(() => null)
  if (!node || node.exitCode !== 0) return ' Warning: node is not on PATH, and the bridge needs it.'
  return ''
}

async function setup($: EngineInterface): Promise<string> {
  const reported = await $.session.version().catch(() => null)
  const text = versionText(reported)
  if (!text) return "Could not read Claude Code's version, so nothing was changed."
  if (isOlderThan(text, MIN_VERSION)) {
    return `Claude Code ${text} does not send prompt_cache to the status line (needs 2.1.251+). Nothing changed.`
  }
  const blocked = await higherStatusLine($)
  if (blocked) {
    const where = blocked === 'policy' ? 'managed settings' : blocked === 'flag' ? '--settings' : `${blocked} settings`
    return `Your status line comes from ${where}, which this setup does not edit. Nothing changed.`
  }
  const config = await configOf($)
  if (!config) return 'HOME is not set, so the Claude config folder is unknown. Nothing changed.'
  const dir = bridgeDirectory(config)
  const file = `${config}/settings.json`
  const settings = await readJson($, file)
  const current = asStatusLine(settings.statusLine)
  if (typeof current?.command === 'string' && current.command.includes(BRIDGE)) {
    await copyBridge($, dir)
    return 'cache-clock is already set up. The bridge script is up to date.'
  }
  const key = fnv(file)
  const wrapped = typeof current?.command === 'string' && current.command.trim() ? current.command : null
  await copyBridge($, dir)
  await $.fs.write(`${dir}/setup-${key}.json`, JSON.stringify({ file, previous: current ?? null, wrapped }, null, 2) + '\n')
  settings.statusLine = { ...(current ?? {}), type: 'command', command: `node "${shellQuoted(`${dir}/bridge.mjs`)}" ${key}` }
  await $.fs.write(file, JSON.stringify(settings, null, 2) + '\n')
  const kept = wrapped ? ' Your status line still prints as before.' : ''
  return `cache-clock bridge set up in ${file}.${kept} The band uses Claude Code's own TTL after the next reply.${await nodeWarning($)} /cache-clock remove puts it back.`
}

async function remove($: EngineInterface): Promise<string> {
  const config = await configOf($)
  if (!config) return 'HOME is not set. Nothing changed.'
  const dir = bridgeDirectory(config)
  const file = `${config}/settings.json`
  const key = fnv(file)
  const savedText = await $.fs.read(`${dir}/setup-${key}.json`).catch(() => null)
  let saved: { previous?: unknown } | null = null
  if (typeof savedText === 'string' && savedText.trim()) {
    try {
      saved = JSON.parse(savedText)
    } catch {
      saved = null
    }
  }
  const settings = await readJson($, file)
  const current = asStatusLine(settings.statusLine)
  if (!(typeof current?.command === 'string' && current.command.includes(BRIDGE))) {
    return 'cache-clock bridge is not set up in your user settings. Nothing changed.'
  }
  if (saved?.previous) settings.statusLine = saved.previous
  else delete settings.statusLine
  await $.fs.write(file, JSON.stringify(settings, null, 2) + '\n')
  await $.fs.write(`${dir}/setup-${key}.json`, '{}\n')
  return 'cache-clock bridge removed. The band falls back to your settings or env TTL, or to the cacheMinutes option (marked as an estimate).'
}
