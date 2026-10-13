import { expect, mock, test } from 'claude-code/testing'

const PROPS = { hasSurvey: false, isWorking: false, maxRows: 8, bodyColumns: 120, scroll: { offset: 0, bodyRows: 8 }, view: {} }
const T0 = 1_000_000

const usage = (model: string, reads: number, writes: number, fresh: number) => ({
  model,
  input_tokens: fresh,
  output_tokens: 100,
  cache_read_input_tokens: reads,
  cache_creation_input_tokens: writes,
})

// a bottom turn.step whose answer carries whatever `next.usage` holds when the step runs
function stepper(on: any) {
  const box: { usage: ReturnType<typeof usage> | null } = { usage: null }
  on('turn.step', async function* (_$: any, e: any) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: box.usage }
  })
  return box
}

async function step($: any, agentId?: string) {
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 3, agentId })
  for await (const _ of stream) void _
  await stream.result
}

async function lineText($: any, ui: any) {
  const texts = await ui.findAll({ type: 'Text' })
  return texts.map((t: any) => t.text).join('')
}

test('the Compact button calls $.session.compact once and toasts the result', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const calls: unknown[] = []
  const toasts: string[] = []
  on('session.compact', async () => {
    calls.push(1)
    return { messages: [{ role: 'user', text: 'summary of the session', toolUses: [] }], tokensBefore: 180000, tokensAfter: 9000 }
  })
  on('ui.toast', (_$: any, e: any) => {
    toasts.push(e.text)
    return { value: undefined } as never
  })
  const box = stepper(on)
  box.usage = usage('claude-opus-5-5', 170000, 10000, 500)
  await step($)
  await clock.advance(60000)

  const ui = await $.ui.mount({ plugin: 'cache-clock', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  expect(calls).toHaveLength(0)
  await ui.press({ key: 'compact' })

  expect(calls).toEqual([1])
  expect(toasts.at(-1)).toBe('Compacted: 180k to 9.0k tokens.')
})

test('the band shows the countdown, reuse, cached tokens and the cold-rewrite estimate', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const box = stepper(on)
  box.usage = usage('claude-opus-5-5', 170000, 10000, 500)
  await step($)
  await clock.advance(8 * 60000)

  const ui = await $.ui.mount({ plugin: 'cache-clock', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  const text = await lineText($, ui)
  // 180000 cached at the 1-hour write price of Opus 5.5 ($8 per MTok) = $1.44
  expect(text).toContain('● CACHE')
  expect(text).toContain('warm 52m')
  expect(text).toContain('94% reused')
  expect(text).toContain('180k cached')
  expect(text).toContain('cold rewrite ≈ $1.44')
  const chip = await ui.find({ type: 'Text', text: '● CACHE' })
  expect(chip?.props).toMatchObject({ bold: true, color: '#b8aece', backgroundColor: '#3b2160' })
})

test('a subagent step counts in totals but does not restart the countdown', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const box = stepper(on)
  box.usage = usage('claude-opus-5-5', 1000, 100000, 0)
  await step($)
  await clock.advance(10 * 60000)
  box.usage = usage('claude-opus-5-5', 5000, 0, 0)
  await step($, 'agent-1')

  const ui = await $.ui.mount({ plugin: 'cache-clock', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  const text = await lineText($, ui)
  expect(text).toContain('warm 50m')
  expect(text).toContain('101k cached')
})

test('an unpriced model shows ≈ ? and the band goes COLD at zero', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const box = stepper(on)
  box.usage = usage('claude-some-future-model', 1000, 1000, 0)
  await step($)
  await clock.advance(61 * 60000)

  const ui = await $.ui.mount({ plugin: 'cache-clock', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  const text = await lineText($, ui)
  expect(text).toContain('COLD')
  expect(text).toContain('cold rewrite ≈ ?')
})

test('it stacks above another mod\'s band line instead of replacing it', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const box = stepper(on)
  on('ui.render', { component: 'AbovePrompt' }, async ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return Text({ children: 'other-mod line' })
  })
  box.usage = usage('claude-opus-5-5', 1000, 1000, 0)
  await step($)
  await clock.advance(1000)

  const ui = await $.ui.mount({ plugin: 'cache-clock', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  const text = await lineText($, ui)
  expect(text).toContain('● CACHE')
  expect(text).toContain('other-mod line')
})
