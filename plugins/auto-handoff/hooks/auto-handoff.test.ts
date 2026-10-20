import type { On, RenderElement } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { ago, branchFromHead, isSafeGitdir, meter, modelLabel, objectiveOf } from './register'

const BAND = {
  plugin: 'auto-handoff',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

// What the engine answers beneath the plugin.
const engine = (on: On) => {
  mock.store(on)
  mock.clock(on)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, {}, 'another mod line') as RenderElement
  })
  on('session.measure', (_$, e) => ({ changed: e.changed }))
}

const usage = (percent: number) => ({
  context: { window: 200000, percent },
  rateLimits: [],
  changed: ['context' as const],
})

test('pure helpers', () => {
  expect(meter(62)).toBe('▰▰▰▰▱▱')
  expect(meter(0)).toBe('▱▱▱▱▱▱')
  expect(modelLabel('claude-sonnet-5-5')).toBe('sonnet 5.5')
  expect(modelLabel('claude-opus-4')).toBe('opus 4')
  expect(modelLabel('gpt-x')).toBe('gpt-x')
  expect(ago(2 * 24 * 3600 * 1000)).toBe('2d ago')
  expect(ago(5 * 60 * 1000)).toBe('5m ago')
  expect(objectiveOf('# Handoff\n## Objective\nShip the band\n## Done')).toBe('Ship the band')
  expect(objectiveOf('**Objective:** Fix login')).toBe('Fix login')
  expect(branchFromHead('ref: refs/heads/feat/x\n')).toBe('feat/x')
  expect(branchFromHead('0123456789abcdef\n')).toBe('0123456')
  expect(branchFromHead('ref: refs/heads/a\x1b[2Jb\n')).toBe('a[2Jb')
  expect(isSafeGitdir('/repo/.git/worktrees/wt')).toBe(true)
  expect(isSafeGitdir('//host/share/.git/worktrees/x')).toBe(false)
  expect(isSafeGitdir('\\\\host\\share\\.git\\worktrees\\x')).toBe(false)
  expect(isSafeGitdir('/etc')).toBe(false)
  expect(isSafeGitdir('/\\host\\share\\.git\\worktrees\\x')).toBe(false)
  expect(isSafeGitdir('\\/host/share/.git/worktrees/x')).toBe(false)
  expect(isSafeGitdir('C:\\r\\.git\\worktrees\\x')).toBe(true)
})

test('band shows chip, meter and threshold on terminal and desktop', async ($, on) => {
  engine(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    await $.session.measure(usage(62))
    await ui.redraw()
    const text = (await ui.find({ type: 'Text', text: /HANDOFF/ }))?.text ?? ''
    expect(text).toContain('HANDOFF ⇄')
    expect(await ui.find({ type: 'Text', text: /ctx ▰▰▰▰▱▱ 62%/ })).toBeDefined()
    expect(await ui.find({ key: 'save' })).toBeDefined()
    // Stacked on top of the other mod's line, not replacing it.
    expect(await ui.find({ type: 'Text', text: /another mod line/ })).toBeDefined()
    await ui.unmount()
  }
})

test('ask mode: crossing the threshold keeps the meter and arms the save', async ($, on) => {
  engine(on)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await $.session.measure(usage(85))
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /ctx ▰▰▰▰▰▱ 85%/ })).toBeDefined()
  await ui.unmount()
})
