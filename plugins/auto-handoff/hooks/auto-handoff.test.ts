import type { On, RenderElement } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { ago, meter, objectiveOf } from './register'

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
  expect(ago(2 * 24 * 3600 * 1000)).toBe('2d ago')
  expect(ago(5 * 60 * 1000)).toBe('5m ago')
  expect(objectiveOf('# Handoff\n## Objective\nShip the band\n## Done')).toBe('Ship the band')
  expect(objectiveOf('**Objective:** Fix login')).toBe('Fix login')
})

test('band shows chip, meter and threshold on terminal and desktop', async ($, on) => {
  engine(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    await $.session.measure(usage(62))
    await ui.redraw()
    const text = (await ui.find({ type: 'Text', text: /HANDOFF/ }))?.text ?? ''
    expect(text).toContain('⇄ HANDOFF')
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
