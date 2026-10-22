import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentRow, Run, Settings } from '../types'
import type { Seg } from './lib'
import {
  HELP,
  MAIN,
  SEP,
  addCall,
  addSkill,
  addUsage,
  bandSegs,
  emptyRun,
  modelColor,
  seconds,
  statusColor,
  statusMark,
  text,
  timelineBar,
  tokens,
  touch,
  tree,
} from './lib'

const PANE = 'agent-watch'
const DEFAULTS: Settings = { isOn: true }

const run = atom({ plugin: 'agent-watch', key: 'run' } as const, null)
const settings = atom({ plugin: 'agent-watch', key: 'settings' } as const, DEFAULTS)

const isSettings = (v: unknown): v is Settings =>
  typeof v === 'object' && v !== null && typeof (v as Settings).isOn === 'boolean'

const agentOf = (e: { agentId?: string }): string => e.agentId ?? MAIN

/** Applies `fn` to the current turn's run, starting one when none is open. */
async function change($: EngineInterface, fn: (r: Run, now: number) => Run) {
  try {
    const now: number = await $.clock.now()
    await update($, run, cur => fn(cur ?? touch(emptyRun(now), MAIN, now, () => ({})), now))
  } catch {
    // Watching must never break a tool call or a turn.
  }
}


export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const saved = await $.store.get('settings')
    if (isSettings(saved)) await update($, settings, () => saved)
    await $.command.register({
      name: 'agent-watch',
      description: 'Who is doing the work this turn: agents, models, tasks, skills',
      argumentHint: 'on | off | clear | help',
    })

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (!e.turnId) return next(e)
    const now: number = await $.clock.now()
    await update($, run, () => touch(emptyRun(now), MAIN, now, () => ({ status: 'running' })))

    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if ('agentId' in started && started.agentId) {
      const id = started.agentId
      await change($, (r, now) =>
        touch(r, id, now, a => ({
          type: e.name ?? e.subagentType,
          task: e.description || e.prompt,
          model: a.model || started.model,
          parent: e.parentAgentId ?? MAIN,
        })),
      )
    }

    return started
  })

  on('tool.call', async ($, e, next) => {
    const id = agentOf(e)
    await change($, (r, now) => {
      const counted = addCall(r, id, now)
      // Remember who called the Skill tool, so its skill.prompt lands on that agent.
      return e.tool === 'Skill'
        ? { ...counted, pending: [...counted.pending, { skill: String(e.skill), agentId: id }] }
        : counted
    })

    return next(e)
  })

  on('skill.prompt', async ($, e, next) => {
    await change($, (r, now) => {
      const at = r.pending.findIndex(p => p.skill === e.skill)
      const owner = at >= 0 ? (r.pending[at]?.agentId ?? MAIN) : MAIN
      const rest = at >= 0 ? r.pending.filter((_, i) => i !== at) : r.pending

      return addSkill({ ...r, pending: rest }, owner, e.skill, now)
    })

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    const used = result?.usage
    await change($, (r, now) =>
      addUsage(
        r,
        agentOf(e),
        used?.model ?? e.model,
        used ? used.input_tokens + used.cache_read_input_tokens + used.cache_creation_input_tokens : 0,
        used ? used.output_tokens : 0,
        now,
      ),
    )

    return result
  })

  on('turn.complete', async ($, e, next) => {
    const id = agentOf(e)
    await change($, (r, now) => {
      const done = touch(r, id, now, () => ({
        status: e.reason === 'answer' ? 'done' : 'failed',
        endedAt: now,
      }))

      return id === MAIN ? { ...done, endedAt: now } : done
    })

    return next(e)
  })

  on('command.run', { command: 'agent-watch' }, async ($, e) => {
    const word = (e.args.trim().split(/\s+/)[0] ?? '').toLowerCase()
    const cfg: Settings = ((await read($, settings)) as Settings | undefined) ?? DEFAULTS

    if (word === '') {
      await $.ui.open({ id: PANE, title: 'Agents' })

      return { text: 'Agents pane opened.' }
    }
    if (word === 'on' || word === 'off') {
      const next: Settings = { ...cfg, isOn: word === 'on' }
      await update($, settings, () => next)
      await $.store.set('settings', next)

      return { text: `agent-watch band ${word}.` }
    }
    if (word === 'clear') {
      await update($, run, () => null)

      return { text: 'agent-watch cleared.' }
    }

    return { text: HELP }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const cfg: Settings = ((await read($, settings)) as Settings | undefined) ?? DEFAULTS
    const r = await read($, run)
    if (e.props.hasSurvey || !cfg.isOn || r === null) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const segs = bandSegs(r, e.props.bodyColumns)
    const draw = (s: Seg) => (
      <Text bold={s.bold} dimColor={s.dim} color={s.color} backgroundColor={s.bg}>
        {s.t}
      </Text>
    )
    // proportional fonts collapse the padded label and │ columns: the groups between them, spaced by gap
    const groups: Seg[][] = [[]]
    for (const s of segs) {
      if (s === SEP) groups.push([])
      else groups[groups.length - 1]?.push(s)
    }
    const line = e.surface !== 'terminal' ? (
      <Box flexDirection="row" alignItems="center" flexWrap="wrap" columnGap={3}>
        {groups.map((g, i) => (
          <Text>{i === 0 ? <Text dimColor bold>{text(g).trim()}</Text> : g.map(draw)}</Text>
        ))}
      </Box>
    ) : (
      <Text wrap="truncate-end">
        {segs.map(s => (
          <Text bold={s.bold} dimColor={s.dim} color={s.color} backgroundColor={s.bg}>
            {s.t}
          </Text>
        ))}
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
    const r = await read($, run)
    if (r === null) {
      return (
        <Box flexDirection="column">
          <Text bold>Agents</Text>
          <Text dimColor>No turn yet.</Text>
        </Box>
      )
    }

    const now: number = await $.clock.now()
    const total = Math.max(1, (r.endedAt ?? now) - r.startedAt)
    const rows = tree(r)
    const barWidth = Math.max(10, Math.min(40, (e.props.bodyColumns ?? 60) - 30))
    const models = Object.entries(r.byModel)
    // the terminal's █ and · cells; elsewhere one Svg span on a 240px track
    const Span = (start: number, end: number, row: AgentRow) => {
      if (e.surface === 'terminal') {
        return (
          <Text>
            <Text color={statusColor(row.status)}>{timelineBar(start, end, total, barWidth)}</Text>
            <Text dimColor> {row.type}</Text>
          </Text>
        )
      }
      const { Svg } = $.ui.resolve(e)
      const x = Math.round(Math.min(1, Math.max(0, start / total)) * 240)
      const w = Math.max(3, Math.round(Math.min(1, Math.max(0, end / total)) * 240) - x)
      return (
        <Box flexDirection="row" alignItems="center" gap={1}>
          <Svg
            source={`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="8" viewBox="0 0 240 8"><rect width="240" height="8" rx="4" fill="#8080804d"/><rect x="${x}" width="${w}" height="8" rx="4" fill="${statusColor(row.status)}"/></svg>`}
            alt={`${row.type} ${seconds(end - start)}`}
            width={240}
            height={8}
          />
          <Text dimColor>{row.type}</Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Text bold>Agents</Text>
        {rows.map(({ row, depth }) => (
          <Box flexDirection="column" marginTop={1} marginLeft={depth * 2}>
            <Text>
              <Text bold>{row.type}</Text>
              {row.task ? <Text bold> — {row.task}</Text> : null}{' '}
              <Text color={statusColor(row.status)}>{statusMark(row.status)}</Text>
            </Text>
            <Text dimColor>
              model <Text color={modelColor(row.model)}>{row.model || 'unknown'}</Text>
              {' · '}calls {row.calls}
              {' · '}tokens {tokens(row.tokensIn)} in / {tokens(row.tokensOut)} out
            </Text>
            <Text dimColor>skills: {row.skills.length > 0 ? row.skills.join(', ') : 'none'}</Text>
          </Box>
        ))}
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Totals per model</Text>
          {models.length === 0 && <Text dimColor>No model steps yet.</Text>}
          {models.map(([label, m]) => (
            <Text>
              <Text color={modelColor(label)}>{label}</Text>
              <Text dimColor>
                {' '}
                {m.steps} steps · {m.calls} calls · {tokens(m.tokensIn)} in / {tokens(m.tokensOut)} out
              </Text>
            </Text>
          ))}
        </Box>
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Timeline ({seconds(total)})</Text>
          {rows.map(({ row }) => Span(row.startedAt - r.startedAt, (row.endedAt ?? now) - r.startedAt, row))}
        </Box>
      </Box>
    )
  })
}
