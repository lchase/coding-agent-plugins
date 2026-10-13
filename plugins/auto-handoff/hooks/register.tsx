import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Band } from '../types'

type Mode = 'auto' | 'ask'
type Settings = { on: boolean; mode: Mode; threshold: number; hidden: boolean }

const DEFAULTS: Settings = { on: true, mode: 'ask', threshold: 80, hidden: false }
const FRESH_MS = 10 * 60 * 1000
const FILE = 'HANDOFF.md'

const CHIP_BG = '#6d28d9'
const CHIP_FG = '#f5f3ff'
const GREEN = '#4ade80'
const AMBER = '#fbbf24'
const RED = '#f87171'

const FALLBACK_SAVE =
  `Write a handoff for this session to ${FILE} in the current folder, so a fresh chat can continue without me. ` +
  'Use these sections: Objective, Done / In progress / Next, Decisions and why, Open questions, Exact next step. ' +
  'Be concrete (file paths, commands, names). Write the file now, then reply with one line.'
const FALLBACK_RESUME =
  `Read ${FILE} in the current folder and continue the work from its "Exact next step". ` +
  'Summarise the objective back to me in one line first.'

const IDLE: Band = { percent: null, phase: 'idle', savedAt: null, seen: 0, from: null }
const band = atom({ plugin: 'auto-handoff', key: 'band' } as const, IDLE)

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

export const ago = (ms: number): string => {
  const mins = Math.floor(Math.max(0, ms) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

const hhmm = (ms: number): string => {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

export const meter = (percent: number): string => {
  const filled = clamp(Math.round((percent / 100) * 6), 0, 6)
  return '▰'.repeat(filled) + '▱'.repeat(6 - filled)
}

export const objectiveOf = (text: string): string => {
  const lines = text.split('\n')
  const at = lines.findIndex(l => /objective/i.test(l))
  if (at < 0) return ''
  const inline = lines[at]!.replace(/^[#*\s>-]*objective[:*\s]*/i, '').trim()
  const raw = inline || lines.slice(at + 1).find(l => l.trim() !== '' && !/^#/.test(l.trim())) || ''
  const clean = raw.replace(/^[\s>*-]+/, '').replace(/[*_`]/g, '').trim()
  return clean.length > 60 ? `${clean.slice(0, 59)}…` : clean
}

async function load($: EngineInterface): Promise<Settings> {
  const raw = (await $.store.get('settings')) as Partial<Settings> | undefined
  const s = { ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) }
  s.threshold = clamp(Math.round(Number(s.threshold) || DEFAULTS.threshold), 10, 99)
  s.mode = s.mode === 'auto' ? 'auto' : 'ask'
  return s
}

async function save($: EngineInterface, s: Settings) {
  await $.store.set('settings', s)
  $.ui.invalidate('ui.render')
}

async function mtimeOf($: EngineInterface): Promise<number | undefined> {
  const stat = await $.fs.stat(FILE).catch(() => undefined)
  return stat ? (stat.mtimeMs as number) : undefined
}

async function hasCommand($: EngineInterface, name: string): Promise<boolean> {
  return (await $.command.list()).some((c: { name: string }) => c.name === name)
}

async function runSave($: EngineInterface) {
  try {
    if (await hasCommand($, 'handoff')) await $.command.run({ command: 'handoff' })
    else await $.prompt.submit({ text: FALLBACK_SAVE })
  } catch (err) {
    $.ui.toast(`auto-handoff: could not save (${(err as Error).message})`)
  }
}

async function runResume($: EngineInterface) {
  try {
    if (await hasCommand($, 'handoff')) await $.command.run({ command: 'handoff', args: 'resume' })
    else await $.prompt.submit({ text: FALLBACK_RESUME })
  } catch (err) {
    $.ui.toast(`auto-handoff: could not resume (${(err as Error).message})`)
  }
}

// Slash commands run from a timer, never inside the hook the turn waits on.
function later($: EngineInterface, fn: () => Promise<void>) {
  $.clock.after(50, () => void fn())
}

async function startSave($: EngineInterface, why: 'threshold' | 'manual') {
  await update($, band, (b): Band => ({ ...b, phase: 'saving', from: null }))
  if (why === 'manual') $.ui.toast('Saving a handoff')
  later($, () => runSave($))
}

async function clearAndContinue($: EngineInterface) {
  await $.store.set('resumeAfterClear', true)
  later($, async () => {
    try {
      await $.command.run({ command: 'clear' })
    } catch (err) {
      await $.store.delete('resumeAfterClear')
      $.ui.toast(`auto-handoff: /clear failed (${(err as Error).message})`)
      return
    }
    // A real /clear fires session.start, which consumes the flag. If it did not, finish here.
    await $.clock.sleep(1500)
    if ((await $.store.get('resumeAfterClear')) === true) {
      await $.store.delete('resumeAfterClear')
      await runResume($)
    }
  })
}

async function warnStale($: EngineInterface) {
  const s = await load($)
  const mtime = (await mtimeOf($)) ?? ((await $.store.get('lastHandoffAt')) as number | undefined)
  const now = await $.clock.now()
  const isFresh = mtime !== undefined && now - mtime < FRESH_MS
  if (s.on && !isFresh) $.ui.toast('Compacting without a fresh handoff')
}

async function detectSaved($: EngineInterface) {
  const mtime = await mtimeOf($)
  if (mtime === undefined) return
  const b = await read($, band)
  if (mtime > b.seen && b.phase !== 'saved') {
    await $.store.set('lastHandoffAt', mtime)
    await update($, band, (cur): Band => ({ ...cur, phase: 'saved', savedAt: mtime, seen: mtime }))
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'auto-handoff',
      description: 'Context watcher: on|off|now|resume|threshold <n>|mode auto|ask|hide|show|status',
      argumentHint: 'on|off|now|resume|threshold <n>|mode auto|ask|hide|show|status',
    })

    const mtime = await mtimeOf($)
    const now = await $.clock.now()
    const resumeFlag = (await $.store.get('resumeAfterClear')) === true

    // Load-time baseline: a file already there is "seen", not "just saved".
    await update($, band, () => ({
      ...IDLE,
      seen: mtime ?? 0,
      from: mtime !== undefined && !resumeFlag ? { at: mtime, objective: '' } : null,
    }))

    if (resumeFlag) {
      await $.store.delete('resumeAfterClear')
      later($, () => runResume($))
    } else if (mtime !== undefined) {
      const text = await $.fs.read(FILE).catch(() => '')
      const objective = objectiveOf(text)
      await update($, band, b => ({ ...b, from: { at: mtime, objective } }))
      const s = await load($)
      if (s.on) $.ui.toast(`Handoff from ${ago(now - mtime)} available, /handoff resume`)
    }

    $.clock.every(4000, () => void detectSaved($))

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    await update($, band, cur => (cur.from === null ? cur : { ...cur, from: null })).catch(() => undefined)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) await detectSaved($)
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const percent = e.context.percent
    if (typeof percent === 'number') {
      const s = await load($)
      const b = await read($, band)
      const below = percent < s.threshold

      if (b.percent !== percent) await update($, band, cur => ({ ...cur, percent }))

      if (s.on && !below && b.phase === 'idle') {
        $.ui.toast(`Chat is ${s.threshold}% full, saving a handoff`)
        if (s.mode === 'auto') await startSave($, 'threshold')
        else await update($, band, (cur): Band => ({ ...cur, phase: 'ask' }))
      } else if (below && (b.phase === 'ask' || b.phase === 'saved')) {
        // Context shrank (compact or clear): arm again.
        await update($, band, (cur): Band => ({ ...cur, phase: 'idle' }))
      }
    }
    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    if (e.agentId === undefined && e.trigger !== 'precompute') {
      await warnStale($).catch(() => undefined)
    }
    return next(e)
  })

  on('command.run', { command: 'auto-handoff' }, async ($, e) => {
    const [verb = 'status', arg] = e.args.trim().split(/\s+/)
    const s = await load($)
    const b = await read($, band)
    const line = `auto-handoff ${s.on ? 'on' : 'off'}, mode ${s.mode}, threshold ${s.threshold}%, band ${s.hidden ? 'hidden' : 'shown'}, context ${b.percent ?? '?'}%`

    switch (verb.toLowerCase()) {
      case 'on':
      case 'off':
        await save($, { ...s, on: verb.toLowerCase() === 'on' })
        return { text: `auto-handoff ${verb.toLowerCase()}` }
      case 'hide':
      case 'show':
        await save($, { ...s, hidden: verb.toLowerCase() === 'hide' })
        return { text: `band ${verb.toLowerCase() === 'hide' ? 'hidden' : 'shown'}` }
      case 'mode':
        if (arg !== 'auto' && arg !== 'ask') return { text: 'usage: /auto-handoff mode auto|ask' }
        await save($, { ...s, mode: arg })
        return { text: `mode ${arg}` }
      case 'threshold': {
        const n = Number(arg)
        if (!Number.isFinite(n) || n < 10 || n > 99) return { text: 'usage: /auto-handoff threshold <10-99>' }
        await save($, { ...s, threshold: Math.round(n) })
        return { text: `threshold ${Math.round(n)}%` }
      }
      case 'now':
        await startSave($, 'manual')
        return { text: 'saving a handoff' }
      case 'resume':
        later($, () => runResume($))
        return { text: 'resuming from HANDOFF.md' }
      case 'status':
        return { text: line }
      default:
        return { text: `${line}\nusage: /auto-handoff on|off|now|resume|threshold <n>|mode auto|ask|hide|show|status` }
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    const s = await load($)
    const b = await read($, band)

    if (e.props.hasSurvey || !s.on || s.hidden) return below

    const { Box, Text, Button } = $.ui.resolve(e)
    const now = await $.clock.now()

    const chip = (
      <Text bold color={CHIP_FG} backgroundColor={CHIP_BG}>
        {' ⇄ HANDOFF '}
      </Text>
    )

    let body
    if (b.phase === 'saved' && b.savedAt !== null) {
      body = (
        <Box>
          <Text color={GREEN}>{`✓ saved ${hhmm(b.savedAt)} `}</Text>
          <Button key="clear" plain hotkey="c" label="clear & continue" onPress={() => clearAndContinue($)} />
        </Box>
      )
    } else if (b.phase === 'idle' && b.from !== null && b.percent !== null && b.percent < s.threshold && b.from.at > 0) {
      const what = b.from.objective === '' ? 'handoff' : b.from.objective
      body = (
        <Box>
          <Text>{`from ${ago(now - b.from.at)}: ${what} `}</Text>
          <Button
            key="resume"
            plain
            hotkey="r"
            label="resume"
            onPress={() => {
              later($, () => runResume($))
              return update($, band, cur => ({ ...cur, from: null }))
            }}
          />
        </Box>
      )
    } else {
      const percent = b.percent ?? 0
      const isHot = b.phase === 'ask' || b.phase === 'saving' || percent >= s.threshold
      const color = isHot ? RED : percent >= 60 ? AMBER : GREEN
      body = (
        <Box>
          <Text color={color}>{`ctx ${meter(percent)} ${Math.round(percent)}% `}</Text>
          <Text dimColor>{b.phase === 'saving' ? '· saving handoff… ' : `· ${s.mode === 'auto' ? 'auto-saves' : 'saves'} at ${s.threshold}% `}</Text>
          {b.phase !== 'saving' && (
            <Button key="save" plain hotkey="h" label="save now" onPress={() => startSave($, 'manual')} />
          )}
        </Box>
      )
    }

    const line = (
      <Box>
        {chip}
        <Text> </Text>
        {body}
      </Box>
    )

    return below ? (
      <Box flexDirection="column">
        {below}
        {line}
      </Box>
    ) : (
      line
    )
  })
}
