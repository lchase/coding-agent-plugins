import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Hud, Tokens } from '../types'

// last main-loop request (each one re-reads and refreshes the cache); an atom so a hot reload keeps it
const activity = atom({ plugin: 'hud-band', key: 'lastActivity' } as const, 0)
// effort of the last main-loop request that reported one
const effortAtom = atom({ plugin: 'hud-band', key: 'effort' } as const, '')
// session totals of the main conversation: input_tokens, output, and cache reads plus writes
const tokens = atom({ plugin: 'hud-band', key: 'tokens' } as const, { inp: 0, out: 0, cached: 0 } as Tokens)
const hud = atom({ plugin: 'hud-band', key: 'hud' } as const, { tool: null, tools: 0 } as Hud)

const GREY = '#c0c0c0'
const MIN = 60000
// ponytail: assumes the 1h cache TTL; cache-keeper's 5-minute TTL detection not ported
const TTL_MIN = 60
const LIMIT_LABEL: Record<string, string> = { five_hour: '5h', seven_day: 'week', spend_limit: 'spend' }
const tok = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}k` : String(n))
const mins = (ms: number) => (ms >= 60 * MIN ? `${Math.floor(ms / (60 * MIN))}h${String(Math.round(ms / MIN) % 60).padStart(2, '0')}m` : `${Math.max(1, Math.round(ms / MIN))}m`)

// ponytail: regex over known families; unknown ids fall through unchanged
const pretty = (id: string) => {
  const g = (
    id.match(/(?<fam>opus|sonnet|haiku|fable)-(?<maj>\d{1,2})(?!\d)(?:-(?<min>\d{1,2})(?!\d))?/) ??
    id.match(/-(?<maj>\d{1,2})(?:-(?<min>\d{1,2}))?-(?<fam>opus|sonnet|haiku|fable)/)
  )?.groups
  if (!g) return id
  const fam = g.fam!
  return `${fam[0]!.toUpperCase()}${fam.slice(1)} ${g.maj}${g.min ? `.${g.min}` : ''}${id.includes('[1m]') ? ' 1M' : ''}`
}

// Handoff: run /session-handoff, capture the answer of the turn it starts, then
// /clear and send it as the fresh chat's first prompt. Ported from cache-keeper.
const SKILL = /(^|:)session-handoff$/
const H = { armed: false, notTurn: '', text: '', path: '', continuing: false }
let pending = false
let working = false
let turnId = ''

function stamp(ms: number) {
  return new Date(ms).toISOString().slice(0, 16).replace(/[-:T]/g, '')
}

async function saveHandoff($: any, text: string) {
  const home = (await $.env.get('HOME')) || (await $.env.get('USERPROFILE')) || '.'
  const cwd: string = await $.session.cwd()
  const project = cwd.split(/[\\/]/).filter(Boolean).pop()?.replace(/[^A-Za-z0-9-]+/g, '-') || 'session'
  const path = `${home}/.claude/mods-data/hud-band/handoffs/${stamp(await $.clock.now())}-${project}.md`
  await $.fs.write(path, text + '\n')
  return path
}

async function captureHandoff($: any, e: any) {
  H.armed = false
  H.notTurn = ''
  const answer = e.reason === 'answer' ? String(e.answer ?? '').trim() : ''
  const i = answer.indexOf('# Session Handoff')
  const body = i > 0 ? answer.slice(i) : answer
  if (body.length < 200) {
    $.ui.toast('The handoff turn ended without a handoff, so nothing was saved.', { timeoutMs: 8000 })
    return
  }
  H.text = body
  H.path = await saveHandoff($, body).catch(() => '')
  $.ui.toast(`${H.path ? `Handoff saved to ${H.path}.` : 'Handoff captured.'} Press c on the band to clear and continue.`, { timeoutMs: 15000 })
}

async function clearAndContinue($: any) {
  if (H.continuing || !H.text) return
  if (working) {
    $.ui.toast('Claude is still working. Clear and continue once this turn ends.', { timeoutMs: 8000 })
    return
  }
  const text = `Handoff from my previous session${H.path ? ` (saved at ${H.path})` : ''}:\n\n${H.text}`
  const path = H.path
  H.continuing = true
  $.ui.invalidate('ui.render')
  try {
    await $.command.run({ command: 'clear', args: '' })
  } catch (err) {
    H.continuing = false
    $.ui.invalidate('ui.render')
    $.ui.toast(`Could not run /clear: ${String((err as Error)?.message ?? err).slice(0, 100)}${path ? ` The handoff is saved at ${path}.` : ''}`, { timeoutMs: 10000 })
    return
  }
  H.text = ''
  H.path = ''
  try {
    await $.prompt.submit({ text, asUser: true })
  } catch {
    // not sent: leave it in the prompt box for one Enter
    const filled = !!(await $.prompt.fill({ text }).catch(() => null))?.isFilled
    $.ui.toast(filled ? 'Cleared. The handoff is in the prompt box: press Enter to send it.' : `Cleared, but the handoff could not be sent.${path ? ` It's saved at ${path}.` : ''}`, { timeoutMs: 10000 })
  } finally {
    H.continuing = false
    $.ui.invalidate('ui.render')
  }
}

async function runHandoff($: any) {
  if (pending || H.armed) {
    $.ui.toast('Session handoff is already queued.')
    return
  }
  try {
    const cmd = (await $.command.list()).find((c: any) => SKILL.test(c.name))
    if (!cmd) {
      $.ui.toast('No /session-handoff skill in this session.', { timeoutMs: 8000 })
      return
    }
    pending = true
    H.armed = true
    H.notTurn = working ? turnId : '' // a turn already running is not the handoff's
    $.ui.invalidate('ui.render')
    $.ui.toast(working ? 'Session handoff queued: it runs when Claude finishes this turn.' : 'Running /session-handoff.')
    await $.command.run({ command: cmd.name, args: '' })
  } catch (err) {
    H.armed = false
    $.ui.toast(`Could not start /session-handoff: ${String((err as Error)?.message ?? err).slice(0, 100)}`, { timeoutMs: 8000 })
  } finally {
    pending = false
    $.ui.invalidate('ui.render')
  }
}


// Session token totals from the transcript, so a reload, resume or late install still counts
// everything said so far. Counted per message id (a reply's blocks repeat its usage).
// ponytail: reads the whole file once per load, tail-read if it ever gets too big.
async function seedTokens($: any) {
  const t: Tokens = { inp: 0, out: 0, cached: 0 }
  try {
    const id: string = await $.session.id()
    const home = (await $.env.get('HOME')) || (await $.env.get('USERPROFILE')) || '.'
    const found = await $.process.run(['find', `${home}/.claude/projects`, '-maxdepth', '2', '-name', `${id}.jsonl`])
    const path = found.stdout.trim().split('\n')[0]
    if (path) {
      const byId = new Map<string, any>()
      for (const line of String(await $.fs.read(path)).split('\n')) {
        if (!line.includes('"usage"')) continue
        try {
          const r = JSON.parse(line)
          if (r.type === 'assistant' && !r.isSidechain && r.message?.usage) byId.set(r.message.id ?? r.uuid, r.message.usage)
        } catch {
          // a partial or foreign line: skip it
        }
      }
      for (const u of byId.values()) {
        t.inp += u.input_tokens ?? 0
        t.out += u.output_tokens ?? 0
        t.cached += (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
      }
    }
  } catch {
    // no transcript: start from zero
  }
  await update($, tokens, () => t)
}

export const register: Register = on => {
  // ponytail: 5s TTL instead of watching .git, add a fs watch if staleness matters
  let branch = { at: 0, name: '' }

  on('turn.start', async ($, e, next) => {
    working = true
    if (e.turnId) turnId = e.turnId
    return next(e)
  })

  on('session.start', async ($, e, next) => {
    $.clock.every(30000, () => $.ui.invalidate('ui.render'))
    seedTokens($).catch(() => {})
    return next(e)
  })

  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    await update($, activity, () => 0)
    seedTokens($).catch(() => {})
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    // keep the last value: some requests carry no effort and must not blank it
    if (!e.agentId && e.effort !== undefined && String(e.effort) !== (await read($, effortAtom))) {
      await update($, effortAtom, () => String(e.effort))
    }
    const result = yield* next(e)
    if (!e.agentId && result && result.usage) {
      const at = await $.clock.now()
      await update($, activity, () => at)
      const u = result.usage
      await update($, tokens, t => ({
        inp: t.inp + u.input_tokens,
        out: t.out + u.output_tokens,
        cached: t.cached + u.cache_read_input_tokens + u.cache_creation_input_tokens,
      }))
    }
    return result
  })

  on('prompt.submit', async ($, e, next) => {
    await update($, hud, () => ({ tool: null, tools: 0 }))
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    await update($, hud, st => ({ tool: e.tool, tools: st.tools + 1 }))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await update($, hud, st => ({ ...st, tool: null }))
    if (e.agentId) return next(e)
    working = false
    if (H.armed && e.turnId !== H.notTurn) await captureHandoff($, e)
    $.ui.invalidate('ui.render')
    return next(e)
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    try {
    const st = await read($, hud)
    const [model, { context, cost, rateLimits }] = await Promise.all([$.session.model(), $.session.usage()])
    if ((await $.clock.now()) - branch.at > 5000) {
      const run = (argv: string[]) => $.process.run(argv).then(r => (r.exitCode === 0 ? r.stdout.trim() : ''), () => '')
      const name = (await run(['git', 'branch', '--show-current'])) || (await run(['git', 'rev-parse', '--short', 'HEAD']))
      branch = { at: await $.clock.now(), name }
    }
    const now = await $.clock.now()
    const lastActivity = await read($, activity)
    const effort = await read($, effortAtom)
    const tk = await read($, tokens)
    const left = lastActivity ? TTL_MIN * MIN - (now - lastActivity) : null
    const cache =
      left === null ? null : left <= 0 ? { text: '○ cache cold', color: GREY } : left <= 5 * MIN ? { text: `◐ cache ${mins(left)}`, color: 'yellow' } : { text: `● cache ${mins(left)}`, color: 'green' }
    const top = Math.max(0, ...rateLimits.map(l => l.percentUsed))
    const limitColor = top >= 95 ? 'red' : top >= 80 ? 'yellow' : GREY
    const pct = context.percent
    const used = Math.min(100, Math.max(0, Math.round(pct ?? 0)))
    const color = used > 85 ? 'red' : used > 60 ? 'yellow' : 'green'
    const filled = Math.round(used / 10)

    // ponytail: no todos/agents, add when wanted
    const segments = (
      <Box>
        <Text bold color={GREY}>{pretty(model)}</Text>
        {effort && <Text color={GREY}> ({effort})</Text>}
        {branch.name && <Text color={GREY}> │ {branch.name}</Text>}
        <Text color={GREY}> │ ctx </Text>
        <Text color={color}>{'█'.repeat(filled)}</Text>
        <Text dimColor>{'░'.repeat(10 - filled)}</Text>
        <Text color={color}> {pct === undefined ? '?' : `${used}%`}</Text>
        {cache && <Text color={GREY}> │ </Text>}
        {cache && <Text color={cache.color}>{cache.text}</Text>}
        {rateLimits.length > 0 && <Text color={GREY}> │ </Text>}
        {rateLimits.length > 0 && (
          <Text color={limitColor}>{rateLimits.map(l => `${LIMIT_LABEL[l.kind] ?? l.kind} ${Math.round(l.percentUsed)}%`).join(' · ')}</Text>
        )}
        {tk.inp + tk.out + tk.cached > 0 && <Box>
            <Text color={GREY}> │ </Text>
            <Text bold color={GREY}>▼</Text>
            <Text color={GREY}> {tok(tk.inp)} </Text>
            <Text bold color={GREY}>▲</Text>
            <Text color={GREY}> {tok(tk.out)} cached {tok(tk.cached)}</Text>
          </Box>}
        {cost && <Text color={GREY}> │ ${cost.usd.toFixed(2)}</Text>}
        <Text color={GREY}> │ tools {st.tools}</Text>
        {st.tool && <Text color={GREY}> │ {'>'} {st.tool}</Text>}
      </Box>
    )
    const busy = pending || H.armed
    const handoff = used > 60 || busy
    const buttons = [
      H.text || H.continuing ? <Button key="continue" label={H.continuing ? 'clearing' : 'clear and continue'} hotkey="c" plain onPress={() => clearAndContinue($)} /> : null,
      handoff ? <Button key="handoff" label={pending ? 'handoff queued' : H.armed ? 'handoff running' : 'handoff'} hotkey="h" plain dimColor={busy} onPress={() => runHandoff($)} /> : null,
    ].filter(Boolean)
    return (
      <Box flexDirection="column">
        {/* the engine pins its mode label to the first row, so the hint goes first and the band under it */}
        {e.props.hint ? <Text dimColor>{e.props.hint}</Text> : <Text> </Text>}
        <Box flexDirection="row" justifyContent="space-between" width="100%" columnGap={2}>
          {segments}
          <Box flexDirection="row" columnGap={2}>{buttons}</Box>
        </Box>
      </Box>
    )
    } catch (err) {
      return <Box><Text color="red">hud-band: {String(err)}</Text></Box>
    }
  })
}
