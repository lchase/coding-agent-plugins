import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const bandProps = (bodyColumns: number) =>
  ({
    plugin: 'agent-watch',
    component: 'AbovePrompt',
    props: {
      hasSurvey: false,
      isWorking: false,
      maxRows: 6,
      bodyColumns,
      scroll: { offset: 0, bodyRows: 5 },
      view: {},
    },
  }) as const

const PANE = {
  plugin: 'agent-watch',
  component: 'Pane',
  requestId: 'agent-watch',
  props: { bodyColumns: 80 },
} as any

// What the engine answers beneath the plugin.
const engine = (on: On) => {
  mock.store(on)
  mock.clock(on)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('agent.spawn', (_$, e) => ({ model: e.model ?? 'claude-haiku-4-5', agentId: `id-${e.description}` }))
  on('skill.prompt', (_$, e) => ({ text: e.text }))
  on('turn.complete', (_$, e) => ({ text: '' }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, {}, 'another mod line') as any
  })
}

async function play($: any) {
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.agent.spawn({ prompt: 'p', description: 'find the hooks', subagentType: 'Explore', model: 'claude-haiku-4-5' })
  await $.agent.spawn({ prompt: 'p', description: 'check the prices', subagentType: 'general-purpose', name: 'fact-checker', model: 'claude-sonnet-5-5' })
  await $.skill.prompt({ skill: 'watch', text: 'x' })
  await $.skill.prompt({ skill: 'watch', text: 'x' })
  await $.turn.complete({ reason: 'answer', turnId: 't1', agentId: 'id-find the hooks', answer: 'ok' } as any)
}

test('band shows chip, agents and one skill on terminal and desktop, stacked on other lines', async ($: any, on: any) => {
  engine(on)
  await play($)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...bandProps(200), surface })
    expect(await ui.find({ type: 'Text', text: / ◎ AGENTS / })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /fact-checker/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /"check the prices"/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^watch$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /another mod line/ })).toBeDefined()
    await ui.unmount()
  }
})

test('task text is dropped first at a narrow width, oldest first', async ($: any, on: any) => {
  engine(on)
  await play($)
  for (const surface of ['terminal', 'desktop'] as const) {
    const wide = await $.ui.mount({ ...bandProps(200), surface })
    expect(await wide.find({ type: 'Text', text: /"check the prices"/ })).toBeDefined()
    await wide.unmount()

    const narrow = await $.ui.mount({ ...bandProps(115), surface })
    expect(await narrow.find({ type: 'Text', text: /"find the hooks"/ })).toBeDefined()
    expect(await narrow.find({ type: 'Text', text: /"check the prices"/ })).toBeUndefined()
    expect(await narrow.find({ type: 'Text', text: /fact-checker/ })).toBeDefined()
    expect(await narrow.find({ type: 'Text', text: /^watch$/ })).toBeDefined()
    await narrow.unmount()
  }
})

test('pane nests agents and lists totals and timeline', async ($: any, on: any) => {
  engine(on)
  await play($)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /Explore/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /find the hooks/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Totals per model/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Timeline/ })).toBeDefined()
    await ui.unmount()
  }
})

test('off hides the band, clear forgets the turn, help lists commands', async ($: any, on: any) => {
  engine(on)
  await play($)
  const off = await $.command.run({ command: 'agent-watch', args: 'off' })
  expect(off.text).toContain('off')
  const ui = await $.ui.mount({ ...bandProps(200), surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: / ◎ AGENTS / })).toBeUndefined()
  await ui.unmount()

  await $.command.run({ command: 'agent-watch', args: 'on' })
  await $.command.run({ command: 'agent-watch', args: 'clear' })
  const empty = await $.ui.mount({ ...bandProps(200), surface: 'terminal' })
  expect(await empty.find({ type: 'Text', text: / ◎ AGENTS / })).toBeUndefined()
  await empty.unmount()

  const help = await $.command.run({ command: 'agent-watch', args: 'help' })
  expect(help.text).toContain('/agent-watch clear')
})
