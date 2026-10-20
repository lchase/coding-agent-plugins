import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { Limit, Reading, Settings, Snapshot } from '../types'
import {
  addReading,
  bar,
  colorFor,
  duration,
  money,
  paceOutMs,
  paceText,
  parseWarn,
  pctText,
  resetText,
  shortLabel,
  windowLabel,
  windowTitle,
} from './lib'

const PANE = 'usage-gauge'
const MAX_TURNS = 10
// 7 cells, the length of 'handoff', so stacked bands line up
const LABEL_W = 7
const DEFAULTS: Settings = { isOn: true, warnA: 75, warnB: 90 }

const snap = atom({ plugin: 'usage-gauge', key: 'snap' } as const, null)
const readings = atom({ plugin: 'usage-gauge', key: 'readings' } as const, {})
const turns = atom({ plugin: 'usage-gauge', key: 'turns' } as const, [])
const prevCost = atom({ plugin: 'usage-gauge', key: 'prevCost' } as const, null)
const settings = atom({ plugin: 'usage-gauge', key: 'settings' } as const, DEFAULTS)

type Measured = {
  rateLimits: readonly Limit[]
  context: { percent?: number }
  cost?: { usd: number }
}

function isSettings(v: unknown): v is Settings {
  const s = v as Settings | null
  return (
    typeof s === 'object' &&
    s !== null &&
    typeof s.isOn === 'boolean' &&
    typeof s.warnA === 'number' &&
    typeof s.warnB === 'number'
  )
}

async function saveSettings($: EngineInterface, next: Settings) {
  await update($, settings, () => next)
  await $.store.set('settings', next)
}

async function ingest($: EngineInterface, m: Measured) {
  const now: number = await $.clock.now()
  const limits: Limit[] = m.rateLimits.map(l => ({
    kind: l.kind,
    percentUsed: l.percentUsed,
    resetsAt: l.resetsAt,
  }))
  const next: Snapshot = {
    rateLimits: limits,
    contextPercent: m.context.percent,
    costUsd: m.cost?.usd,
  }
  await update($, snap, () => next)
  await update($, readings, all => {
    const out: Record<string, Reading[]> = {}
    for (const l of limits) out[l.kind] = addReading(all?.[l.kind], l.percentUsed, now)
    return out
  })

  const cfg: Settings = ((await read($, settings)) as Settings | undefined) ?? DEFAULTS
  if (!cfg.isOn) {
    $.ui.status(undefined)
    return
  }
  const parts = limits.map(l => `${shortLabel(l.kind)} ${pctText(l.percentUsed)}`)
  $.ui.status(parts.length > 0 ? parts.join(' · ') : undefined)

  const stored = (await $.store.get('fired')) as Record<string, string> | undefined
  const fired: Record<string, string> = { ...(stored ?? {}) }
  let isDirty = false
  for (const l of limits) {
    for (const t of [cfg.warnA, cfg.warnB]) {
      const key = `${l.kind}:${t}`
      const mark = l.resetsAt ?? ''
      if (l.percentUsed >= t) {
        if (fired[key] !== mark) {
          fired[key] = mark
          isDirty = true
          const at = resetText(l, now)
          const isSoon = l.resetsAt !== undefined && Date.parse(l.resetsAt) - now < 86_400_000
          const when = at === undefined ? '' : `, resets ${isSoon && at !== 'now' ? 'in ' : ''}${at}`
          $.ui.toast(`${windowTitle(l.kind)} at ${t}%${when}`)
        }
      } else if (key in fired) {
        delete fired[key]
        isDirty = true
      }
    }
  }
  if (isDirty) await $.store.set('fired', fired)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const saved = await $.store.get('settings')
    if (isSettings(saved)) await update($, settings, () => saved)
    await $.command.register({
      name: 'usage-gauge',
      description: 'Plan usage windows, resets and session cost',
      argumentHint: 'on | off | warn <a> <b> | status',
    })
    await ingest($, await $.session.usage())

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await ingest($, e)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) {
      const usage = await $.session.usage()
      if (usage.cost) {
        const total = usage.cost.usd
        const before = await read($, prevCost)
        await update($, prevCost, () => total)
        if (before !== null && total > before) {
          await update($, turns, list => [...list, total - before].slice(-MAX_TURNS))
        }
      }
    }

    return next(e)
  })

  on('command.run', { command: 'usage-gauge' }, async ($, e) => {
    const arg = e.args.trim()
    const cfg: Settings = ((await read($, settings)) as Settings | undefined) ?? DEFAULTS
    const word = arg.split(/\s+/)[0] ?? ''

    if (arg === '') {
      await $.ui.open({ id: PANE, title: 'Usage gauge' })

      return { text: 'Usage gauge pane opened.' }
    }
    if (word === 'on' || word === 'off') {
      await saveSettings($, { ...cfg, isOn: word === 'on' })
      if (word === 'off') $.ui.status(undefined)
      else await ingest($, await $.session.usage())

      return { text: `Usage gauge ${word}.` }
    }
    if (word === 'warn') {
      const parsed = parseWarn(arg)
      if (typeof parsed === 'string') return { text: parsed }
      await saveSettings($, { ...cfg, warnA: parsed.a, warnB: parsed.b })

      return { text: `Toasts at ${parsed.a}% and ${parsed.b}%.` }
    }
    if (word === 'status') {
      const s = await read($, snap)
      const now: number = await $.clock.now()
      const lines = [
        `Usage gauge ${cfg.isOn ? 'on' : 'off'}, toasts at ${cfg.warnA}% and ${cfg.warnB}%.`,
      ]
      for (const l of s?.rateLimits ?? []) {
        const at = resetText(l, now)
        lines.push(`${windowLabel(l.kind)} ${pctText(l.percentUsed)}${at ? ` resets ${at}` : ''}`)
      }
      if (s?.costUsd !== undefined) lines.push(`session ${money(s.costUsd)}`)
      if ((s?.rateLimits.length ?? 0) === 0) lines.push('No plan windows reported (API billing).')

      return { text: lines.join('\n') }
    }

    return { text: 'Usage: /usage-gauge on | off | warn <a> <b> | status' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const cfg: Settings = ((await read($, settings)) as Settings | undefined) ?? DEFAULTS
    const s = await read($, snap)
    if (e.props.hasSurvey || !cfg.isOn || s === null) return next(e)

    const now: number = await $.clock.now()
    const all = await read($, readings)
    const history = await read($, turns)
    const last = history[history.length - 1]
    const hasPlan = s.rateLimits.length > 0
    const hasCtx = s.contextPercent !== undefined
    if (!hasPlan && !hasCtx && s.costUsd === undefined) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const sep = <Text dimColor> │ </Text>
    // filled cells in the level color, empty cells dim
    const Meter = (cells: string, color: string) => (
      <Text>
        <Text color={color}>{cells.replace(/▱/g, '')}</Text>
        <Text dimColor>{cells.replace(/▰/g, '')}</Text>
      </Text>
    )
    const segs: RenderChildren[] = []

    for (const l of s.rateLimits) {
      const c = colorFor(l.percentUsed)
      const at = resetText(l, now)
      const out = l.kind === 'five_hour' ? paceOutMs(all?.[l.kind], l.resetsAt, now) : undefined
      segs.push(
        <Text>
          {windowLabel(l.kind)} {Meter(bar(l.percentUsed, 6), c)} <Text bold color={c}>{pctText(l.percentUsed)}</Text>
          {at ? <Text dimColor> ↻{at}</Text> : null}
          {out !== undefined ? <Text color="#fbbf24"> ⚠ at this pace: out in {paceText(out)}</Text> : null}
        </Text>,
      )
    }
    if (!hasPlan && hasCtx) {
      const pct = s.contextPercent as number
      segs.push(
        <Text>
          <Text dimColor>ctx</Text> {Meter(bar(pct, 6), colorFor(pct))} <Text bold color={colorFor(pct)}>{pctText(pct)}</Text>
        </Text>,
      )
    }
    if (s.costUsd !== undefined) {
      segs.push(
        <Text>
          <Text dimColor>session</Text> {money(s.costUsd)}
          {last !== undefined ? <Text dimColor> (+{money(last)})</Text> : null}
        </Text>,
      )
    }

    const line = (
      <Text wrap="truncate-end">
        <Text dimColor>{(hasPlan ? 'plan' : 'api').padStart(LABEL_W)}</Text>
        {sep}
        {segs.flatMap((seg, i) => (i === 0 ? [seg] : [sep, seg]))}
      </Text>
    )
    const below = await next(e)

    return below ? (
      <Box flexDirection="column">
        {line}
        {below}
      </Box>
    ) : (
      line
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const s = await read($, snap)
    const cfg: Settings = ((await read($, settings)) as Settings | undefined) ?? DEFAULTS
    const all = await read($, readings)
    const history = await read($, turns)
    const now: number = await $.clock.now()
    const width = Math.max(10, Math.min(40, (e.props.bodyColumns ?? 60) - 24))

    return (
      <Box flexDirection="column">
        <Text bold>Usage gauge {cfg.isOn ? '' : '(off)'}</Text>
        {(s?.rateLimits ?? []).length === 0 && (
          <Text dimColor>No plan windows reported (API billing).</Text>
        )}
        {(s?.rateLimits ?? []).map(l => {
          const at = resetText(l, now)
          const out = paceOutMs(all?.[l.kind], l.resetsAt, now)
          return (
            <Box flexDirection="column" marginTop={1}>
              <Text bold>{windowTitle(l.kind)}</Text>
              <Text>
                <Text color={colorFor(l.percentUsed)}>{bar(l.percentUsed, width)}</Text> {pctText(l.percentUsed)}
              </Text>
              <Text dimColor>
                {at ? `resets ${at}${l.resetsAt && Date.parse(l.resetsAt) > now ? ` (in ${duration(Date.parse(l.resetsAt) - now)})` : ''}` : 'no reset time reported'}
              </Text>
              <Text dimColor={out === undefined} color={out === undefined ? undefined : '#fbbf24'}>
                {out === undefined ? 'pace: on track, or too early to tell' : `pace: out in ${paceText(out)} at this rate`}
              </Text>
            </Box>
          )
        })}
        <Box flexDirection="column" marginTop={1}>
          <Text bold>
            Session {s?.costUsd !== undefined ? money(s.costUsd) : ''}
          </Text>
          {history.length === 0 && <Text dimColor>No finished turns yet.</Text>}
          {history.length > 0 && <Text dimColor>Last {history.length} turns</Text>}
          {history.map((c, i) => (
            <Text>
              {String(history.length - i).padStart(2)} ago  {money(c)}
            </Text>
          ))}
        </Box>
      </Box>
    )
  })
}
