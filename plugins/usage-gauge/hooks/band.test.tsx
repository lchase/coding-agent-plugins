import { expect, mock, test } from 'claude-code/testing'

const BAND = {
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 6,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 5 },
    view: {},
  },
} as any

const future = (ms: number) => new Date(Date.now() + ms).toISOString()

test('band shows plan windows, unknown kinds and session cost on every surface', async ($: any, on: any) => {
  mock.clock(on)
  mock.store(on)
  on('session.measure', (_$: any, e: any) => ({ changed: e.changed }))
  on('ui.render', ($: any, e: any) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  await $.session.measure({
    context: { window: 200000, percent: 12 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 34, resetsAt: future(131 * 60_000) },
      { kind: 'seven_day', percentUsed: 83, resetsAt: future(3 * 86_400_000) },
      { kind: 'spend_limit', percentUsed: 10 },
    ],
    cost: { usd: 4.12 },
    changed: ['context', 'rateLimits', 'cost'],
  })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'usage-gauge', surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: /plan/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /34%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /spend_limit/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\$4\.12/ })).toBeDefined()
    // terminal draws ▰▱ cells; the desktop draws Svg meters
    if (surface === 'terminal') expect(await ui.find({ type: 'Text', text: /▰/ })).toBeDefined()
    else {
      expect(await ui.find({ type: 'Svg' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /[▰▱│]/ })).toBeUndefined()
    }
    await ui.unmount()
  }
})

test('API billing shows context and cost, never zeroed windows', async ($: any, on: any) => {
  mock.clock(on)
  mock.store(on)
  on('session.measure', (_$: any, e: any) => ({ changed: e.changed }))
  on('ui.render', ($: any, e: any) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  await $.session.measure({
    context: { window: 200000, percent: 30 },
    rateLimits: [],
    cost: { usd: 1.5 },
    changed: ['context', 'cost'],
  })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'usage-gauge', surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: /ctx/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\$1\.50/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /plan|5h|week/ })).toBeUndefined()
    await ui.unmount()
  }
})
