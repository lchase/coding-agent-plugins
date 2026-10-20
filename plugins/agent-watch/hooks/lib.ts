import type { AgentRow, Run, Status } from '../types'

// label column width, the length of 'handoff', so stacked bands line up
export const LABEL_W = 7
export const SKILL_COLOR = '#a3e635'
export const TASK_MAX = 22
export const MAIN = 'main'

// same purple as auto-handoff's branch name
const MODEL_COLOR = '#b794f4'
const STATUS_COLOR: Record<Status, string> = {
  running: '#f59e0b',
  done: '#22c55e',
  failed: '#ef4444',
}
const STATUS_MARK: Record<Status, string> = { running: '⟳', done: '✓', failed: '✗' }

export const statusColor = (s: Status): string => STATUS_COLOR[s]
export const statusMark = (s: Status): string => STATUS_MARK[s]

const FAMILY_RE = /(fable|opus|sonnet|haiku)/

/** `claude-opus-5-5` -> `opus·5.5`, `claude-3-5-sonnet-20241022` -> `sonnet·3.5`, `haiku` -> `haiku`. */
export function modelLabel(raw: string | undefined): string {
  if (!raw) return ''
  const id = raw.toLowerCase().replace(/\[.*\]$/, '').replace(/-\d{8}$/, '')
  const m = FAMILY_RE.exec(id)
  if (!m) return raw
  const family = m[1] as string
  const after = id.slice(m.index + family.length)
  const before = id.slice(0, m.index)
  const a = /^-(\d+)(?:-(\d+))?$/.exec(after)
  if (a) return `${family}·${a[1]}${a[2] ? `.${a[2]}` : ''}`
  const b = /(\d+)(?:-(\d+))?-$/.exec(before)
  if (b) return `${family}·${b[1]}${b[2] ? `.${b[2]}` : ''}`
  return family
}

export function modelColor(label: string): string | undefined {
  const m = FAMILY_RE.exec(label)
  return m ? MODEL_COLOR : undefined
}

/** Task text cut to `max` characters, ending in an ellipsis when it was longer. */
export function cut(text: string, max = TASK_MAX): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t
}

export type Seg = { t: string; color?: string; bg?: string; bold?: boolean; dim?: boolean }

export const text = (segs: readonly Seg[]): string => segs.map(s => s.t).join('')

export function emptyRun(now: number): Run {
  return { startedAt: now, order: [], agents: {}, skills: [], pending: [], byModel: {} }
}

export function blankAgent(id: string, now: number): AgentRow {
  return {
    id,
    type: id === MAIN ? MAIN : 'agent',
    task: '',
    model: '',
    status: 'running',
    parent: MAIN,
    calls: 0,
    tokensIn: 0,
    tokensOut: 0,
    skills: [],
    startedAt: now,
  }
}

/** Reducer helper: the run with agent `id` present (created when unseen) and patched. */
export function touch(run: Run, id: string, now: number, patch: (a: AgentRow) => Partial<AgentRow>): Run {
  const existing = run.agents[id]
  const base = existing ?? blankAgent(id, now)
  const order = existing || run.order.includes(id) ? run.order : [...run.order, id]
  return { ...run, order, agents: { ...run.agents, [id]: { ...base, ...patch(base) } } }
}

export function addSkill(run: Run, agentId: string, skill: string, now: number): Run {
  const named = touch(run, agentId, now, a => (a.skills.includes(skill) ? {} : { skills: [...a.skills, skill] }))
  return named.skills.includes(skill) ? named : { ...named, skills: [...named.skills, skill] }
}

export function addUsage(run: Run, agentId: string, model: string, tokensIn: number, tokensOut: number, now: number): Run {
  const label = modelLabel(model)
  const next = touch(run, agentId, now, a => ({
    model: label || a.model,
    tokensIn: a.tokensIn + tokensIn,
    tokensOut: a.tokensOut + tokensOut,
  }))
  const key = label || 'unknown'
  const m = next.byModel[key] ?? { steps: 0, calls: 0, tokensIn: 0, tokensOut: 0 }
  return {
    ...next,
    byModel: { ...next.byModel, [key]: { ...m, steps: m.steps + 1, tokensIn: m.tokensIn + tokensIn, tokensOut: m.tokensOut + tokensOut } },
  }
}

export function addCall(run: Run, agentId: string, now: number): Run {
  const next = touch(run, agentId, now, a => ({ calls: a.calls + 1 }))
  const label = next.agents[agentId]?.model || 'unknown'
  const m = next.byModel[label] ?? { steps: 0, calls: 0, tokensIn: 0, tokensOut: 0 }
  return { ...next, byModel: { ...next.byModel, [label]: { ...m, calls: m.calls + 1 } } }
}

/** Helpers in spawn order, main excluded. */
export const helpers = (run: Run): AgentRow[] =>
  run.order.filter(id => id !== MAIN).map(id => run.agents[id] as AgentRow)

function agentSegs(a: AgentRow, withTask: boolean): Seg[] {
  const out: Seg[] = [{ t: '● ', color: modelColor(a.model) }, { t: a.type, bold: a.id === MAIN }]
  if (a.model) out.push({ t: ' ' }, { t: a.model, color: modelColor(a.model) })
  if (withTask && a.id !== MAIN && a.task) out.push({ t: ` "${cut(a.task)}"` })
  out.push({ t: ' ' }, { t: statusMark(a.status), color: statusColor(a.status) })
  return out
}

const SEP: Seg = { t: ' │ ', dim: true }
const DOT: Seg = { t: ' · ', dim: true }

/**
 * The band line as segments, fitted to `columns`. Task text goes first, oldest
 * helper first, except the first helper's. Then newest helpers collapse to
 * "+N more", then skills shrink to the first one plus "+N".
 */
export function bandSegs(run: Run, columns: number): Seg[] {
  const all = helpers(run)
  const main = run.agents[MAIN] ?? { ...blankAgent(MAIN, run.startedAt) }
  const showTask = all.map(() => true)
  let hidden = 0
  let skillsShown = run.skills.length

  const build = (): Seg[] => {
    const segs: Seg[] = [{ t: 'agents'.padStart(LABEL_W), dim: true }, SEP, ...agentSegs(main, false)]
    const visible = all.slice(0, all.length - hidden)
    if (visible.length > 0 || hidden > 0) {
      segs.push(SEP)
      visible.forEach((a, i) => {
        if (i > 0) segs.push(DOT)
        segs.push(...agentSegs(a, showTask[i] as boolean))
      })
      if (hidden > 0) segs.push(...(visible.length > 0 ? [DOT] : []), { t: `+${hidden} more`, dim: true })
    }
    if (run.skills.length > 0) {
      segs.push(SEP, { t: 'skills: ', dim: true })
      run.skills.slice(0, skillsShown).forEach((s, i) => {
        if (i > 0) segs.push({ t: ', ', dim: true })
        segs.push({ t: s, color: SKILL_COLOR })
      })
      const more = run.skills.length - skillsShown
      if (more > 0) segs.push({ t: ` +${more}`, dim: true })
    }
    return segs
  }
  const fits = (): boolean => text(build()).length <= columns

  for (let i = 1; i < all.length && !fits(); i++) showTask[i] = false
  while (!fits() && all.length - hidden > 1) hidden++
  while (!fits() && skillsShown > 1) skillsShown--

  return build()
}

export function tokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

export function seconds(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}

/** A bar of `width` cells placing [start, end] inside [0, total]. */
export function timelineBar(start: number, end: number, total: number, width: number): string {
  if (width < 1) return ''
  const span = Math.max(1, total)
  const from = Math.min(width - 1, Math.max(0, Math.floor((start / span) * width)))
  const to = Math.min(width, Math.max(from + 1, Math.ceil((end / span) * width)))
  return '·'.repeat(from) + '█'.repeat(to - from) + '·'.repeat(width - to)
}

/** Agents depth-first: each helper right after its parent, spawn order among siblings. */
export function tree(run: Run): { row: AgentRow; depth: number }[] {
  const out: { row: AgentRow; depth: number }[] = []
  const seen = new Set<string>()
  const walk = (id: string, depth: number) => {
    const row = run.agents[id]
    if (!row || seen.has(id)) return
    seen.add(id)
    out.push({ row, depth })
    for (const k of run.order) {
      const child = run.agents[k]
      const p = child && child.parent !== k && run.agents[child.parent] ? child.parent : MAIN
      if (k !== MAIN && p === id) walk(k, depth + 1)
    }
  }
  walk(MAIN, 0)
  return out
}

export const HELP = [
  'agent-watch: who is doing the work this turn.',
  '/agent-watch          open the Agents pane',
  '/agent-watch on       show the band above the prompt',
  '/agent-watch off      hide the band (the pane still works)',
  '/agent-watch clear    forget this turn',
  '/agent-watch help     this text',
].join('\n')
