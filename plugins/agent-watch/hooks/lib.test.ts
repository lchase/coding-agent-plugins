import { expect, test } from 'claude-code/testing'

import type { AgentRow, Run } from '../types'
import { addCall, addSkill, addUsage, bandSegs, blankAgent, cut, emptyRun, modelLabel, text, timelineBar, touch, tree } from './lib'

const helper = (id: string, type: string, task: string, model: string, status: AgentRow['status'] = 'running'): Partial<AgentRow> => ({
  type,
  task,
  model,
  status,
})

export function sample(): Run {
  let r = touch(emptyRun(0), 'main', 0, () => ({ model: 'opus·5.5' }))
  r = touch(r, 'a1', 1, () => helper('a1', 'Explore', 'find the hooks', 'haiku·4.5', 'done'))
  r = touch(r, 'a2', 2, () => helper('a2', 'fact-checker', 'check the prices', 'sonnet·5.5'))
  r = addSkill(r, 'main', 'watch', 3)
  return r
}

test('model labels', () => {
  expect(modelLabel('claude-opus-5-5')).toBe('opus·5.5')
  expect(modelLabel('claude-fable-5-1')).toBe('fable·5.1')
  expect(modelLabel('claude-haiku-4-5-20251001')).toBe('haiku·4.5')
  expect(modelLabel('claude-3-5-sonnet-20241022')).toBe('sonnet·3.5')
  expect(modelLabel('haiku')).toBe('haiku')
  expect(modelLabel('')).toBe('')
})

test('task is cut to 22 characters with an ellipsis', () => {
  expect(cut('find the hooks')).toBe('find the hooks')
  const long = cut('summarise every file in the whole repository')
  expect(long.length).toBeLessThanOrEqual(22)
  expect(long.length).toBeGreaterThan(18)
  expect(long.endsWith('…')).toBe(true)
})

test('wide band matches the spec line', () => {
  const line = text(bandSegs(sample(), 200))
  expect(line).toBe(
    '  AGENTS ◎  main opus·5.5 ⟳ │ Explore haiku·4.5 "find the hooks" ✓ · fact-checker sonnet·5.5 "check the prices" ⟳ │ skills: watch',
  )
})

test('narrow band drops task text oldest first, keeps first helper task and a skill', () => {
  const r = sample()
  const full = text(bandSegs(r, 200)).length
  const line = text(bandSegs(r, full - 3))
  expect(line).toContain('"find the hooks"')
  expect(line).not.toContain('"check the prices"')
  expect(line).toContain('fact-checker sonnet·5.5 ⟳')
  expect(line).toContain('skills: watch')
})

test('narrower still shows +N more and keeps one skill', () => {
  let r = sample()
  r = touch(r, 'a3', 4, () => helper('a3', 'Plan', 'draft the steps', 'opus·5.5'))
  r = addSkill(r, 'main', 'second', 5)
  const line = text(bandSegs(r, 100))
  expect(line).toContain('"find the hooks"')
  expect(line).toContain('more')
  expect(line).toContain('skills: watch')
  expect(line.length).toBeLessThanOrEqual(100)
})

test('a skill is counted once however many events name it', () => {
  let r = emptyRun(0)
  r = addSkill(r, 'main', 'watch', 1)
  r = addSkill(r, 'main', 'watch', 2)
  r = addSkill(r, 'a1', 'watch', 3)
  expect(r.skills).toEqual(['watch'])
  expect(r.agents.main?.skills).toEqual(['watch'])
})

test('usage and calls roll up per model', () => {
  let r = touch(emptyRun(0), 'main', 0, () => ({}))
  r = addUsage(r, 'main', 'claude-opus-5-5', 100, 20, 1)
  r = addCall(r, 'main', 2)
  r = addUsage(r, 'a1', 'claude-haiku-4-5-20251001', 50, 5, 3)
  expect(r.byModel['opus·5.5']).toEqual({ steps: 1, calls: 1, tokensIn: 100, tokensOut: 20 })
  expect(r.agents.a1?.model).toBe('haiku·4.5')
})

test('tree nests helpers under their parent', () => {
  let r = sample()
  r = touch(r, 'g', 5, () => ({ ...helper('g', 'Grep', 'inner', 'haiku'), parent: 'a1' }))
  expect(tree(r).map(n => `${n.depth}${n.row.id}`)).toEqual(['0main', '1a1', '2g', '1a2'])
  expect(blankAgent('x', 0).parent).toBe('main')
})

test('timeline bar places the span', () => {
  expect(timelineBar(0, 10, 10, 10)).toBe('██████████')
  expect(timelineBar(5, 10, 10, 10)).toBe('·····█████')
  expect(timelineBar(0, 0, 10, 10)).toBe('█·········')
})
