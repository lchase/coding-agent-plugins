import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const SECRET = 'sk-ant-abcdefghijklmnop1234'

const bandProps = {
  plugin: 'recording-mode',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 120, scroll: { offset: 0, bodyRows: 5 }, view: {} },
} as const

// What the engine draws beneath the plugin: the raw text, so the test sees what the plugin changed.
const engine = (on: On) => {
  mock.store(on)
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'base', scope: 'shared' as const }] }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, {}, 'another mod line') as any
  })
  for (const component of ['UserMessage', 'AssistantMessage', 'CommandOutput'] as const) {
    on('ui.render', { component } as any, ($: any, e: any) => {
      const { Text } = $.ui.resolve(e)
      return h(Text, {}, (e.props as any).text) as any
    })
  }
  for (const component of ['ToolUse', 'ToolResult'] as const) {
    on('ui.render', { component } as any, ($: any, e: any) => {
      const { Text } = $.ui.resolve(e)
      return h(Text, {}, JSON.stringify((e.props as any).input ?? (e.props as any).output)) as any
    })
  }
}

const rows = [
  ['UserMessage', { text: `my key is ${SECRET} and mail a@b.co`, origin: { kind: 'composer' }, isExpanded: false }],
  ['AssistantMessage', { text: `token ${SECRET}`, isFirstOfReply: true }],
  ['CommandOutput', { command: 'x', args: '', text: `Acme owes ${SECRET}` }],
  ['ToolUse', { tool_use_id: 't', tool: 'Bash', input: { command: `curl -H "Authorization: Bearer abcdefgh12345" a@b.co` }, isRunning: false, isErrored: false, isInterrupted: false }],
  ['ToolResult', { tool_use_id: 't', tool: 'Bash', output: { stdout: `API_TOKEN=${SECRET}\nconst x = 42` }, isErrored: false }],
] as const

test('masks display on terminal and desktop, leaves code alone', async ($: any, on: any) => {
  engine(on)
  await $.command.run({ command: 'rec', args: 'hide Acme' })
  await $.command.run({ command: 'rec', args: '' })
  for (const surface of ['terminal', 'desktop'] as const) {
    for (const [component, props] of rows) {
      const ui = await $.ui.mount({ plugin: 'recording-mode', surface, component, props } as any)
      expect(await ui.find({ type: 'Text', text: new RegExp(SECRET.slice(0, 12)) })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: /\[key\]/ })).toBeDefined()
      await ui.unmount()
    }
    const out = await $.ui.mount({ plugin: 'recording-mode', surface, component: 'CommandOutput', props: rows[2][1] } as any)
    expect(await out.find({ type: 'Text', text: /\[private\] owes/ })).toBeDefined()
    await out.unmount()
    const res = await $.ui.mount({ plugin: 'recording-mode', surface, component: 'ToolResult', props: rows[4][1] } as any)
    expect(await res.find({ type: 'Text', text: /const x = 42/ })).toBeDefined()
    await res.unmount()
  }
})

test('off leaves everything as the engine draws it', async ($: any, on: any) => {
  engine(on)
  const ui = await $.ui.mount({ plugin: 'recording-mode', surface: 'terminal', component: 'AssistantMessage', props: rows[1][1] } as any)
  expect(await ui.find({ type: 'Text', text: new RegExp(SECRET.slice(0, 12)) })).toBeDefined()
  await ui.unmount()
})

test('chip stacks on other lines, only while on', async ($: any, on: any) => {
  engine(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const off = await $.ui.mount({ ...bandProps, surface })
    expect(await off.find({ type: 'Text', text: /REC/ })).toBeUndefined()
    await off.unmount()
  }
  await $.command.run({ command: 'rec', args: '' })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...bandProps, surface })
    expect(await ui.find({ type: 'Text', text: / ● REC / })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /another mod line/ })).toBeDefined()
    await ui.unmount()
  }
  await $.command.run({ command: 'rec', args: 'off' })
  const gone = await $.ui.mount({ ...bandProps, surface: 'terminal' })
  expect(await gone.find({ type: 'Text', text: /REC/ })).toBeUndefined()
  await gone.unmount()
})

test('model prompt gains a section only while on', async ($: any, on: any) => {
  engine(on)
  const before = await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] })
  expect(before.sections.map((s: any) => s.id)).toEqual(['intro'])
  await $.command.run({ command: 'rec', args: '' })
  const after = await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] })
  const last = after.sections[after.sections.length - 1]
  expect(last.id).toBe('recording-mode:policy')
  expect(last.scope).toBe('session')
  expect(last.text).toContain("Recording mode is on, so I'll keep that off screen")
})

test('commands: strict, hide, list, unhide, test', async ($: any, on: any) => {
  engine(on)
  expect((await $.command.run({ command: 'rec', args: 'strict' })).text).toContain('strict')
  await $.command.run({ command: 'rec', args: 'hide Acme' })
  await $.command.run({ command: 'rec', args: 'hide zebra' })
  const list = await $.command.run({ command: 'rec', args: 'list' })
  expect(list.text).toContain('2')
  expect(list.text).toContain('A•••')
  expect(list.text).not.toContain('Acme')
  const t = await $.command.run({ command: 'rec', args: 'test Acme paid $40 to a@b.co from /Users/me/x' })
  expect(t.text).toBe('Masked: [private] paid [amount] to [email] from [home]/x')
  await $.command.run({ command: 'rec', args: 'unhide acme' })
  expect((await $.command.run({ command: 'rec', args: 'list' })).text).toContain('1')
})
