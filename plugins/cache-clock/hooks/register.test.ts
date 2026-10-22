import { expect, mock, test } from 'claude-code/testing'

const PROPS = { hasSurvey: false, isWorking: false, maxRows: 8, bodyColumns: 120, scroll: { offset: 0, bodyRows: 8 }, view: {} }
const T0 = 1_000_000_000_000

const usage = (model: string, reads: number, writes: number, fresh: number) => ({
  model,
  input_tokens: fresh,
  output_tokens: 100,
  cache_read_input_tokens: reads,
  cache_creation_input_tokens: writes,
})

// Pin env, settings, and the bridge file so the machine running the tests cannot leak in.
function isolate(
  on: any,
  opts: { env?: Record<string, string>; settings?: Record<string, unknown>; native?: object | null; writtenAt?: number } = {},
) {
  mock.env(on, { HOME: '/home/t', ...(opts.env ?? {}) })
  on('session.id', () => ({ value: 's1' }) as never)
  on('settings.read', () => ({ value: opts.settings ?? {} }) as never)
  on('fs.read', (_$: any, e: any) => {
    if (opts.native && String(e.path).endsWith('/cache-clock/native-s1.json')) {
      return { value: JSON.stringify({ writtenAt: opts.writtenAt ?? T0, prompt_cache: opts.native, model: 'claude-opus-5-5' }) } as never
    }
    return { deny: 'ENOENT' } as never
  })
}

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

async function lineText(ui: any) {
  const texts = await ui.findAll({ type: 'Text' })
  return texts.map((t: any) => t.text).join('')
}

async function mount($: any, surface: 'terminal' | 'desktop' = 'terminal') {
  return $.ui.mount({ plugin: 'cache-clock', surface, component: 'AbovePrompt', props: PROPS })
}

test('desktop draws a gapped row with an Svg meter and a native Compact button', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  isolate(on, { native: { warm: true, ttl: '1h', expires_at: (T0 + 40 * 60000) / 1000, hit_ratio: 0.91, misses: 2, recache_tokens_if_cold: 180000 } })
  const calls: unknown[] = []
  on('session.compact', async () => {
    calls.push(1)
    return { messages: [{ role: 'user', text: 'summary', toolUses: [] }], tokensBefore: 180000, tokensAfter: 9000 }
  })
  const box = stepper(on)
  box.usage = usage('claude-opus-5-5', 170000, 10000, 500)
  await step($)
  await clock.advance(1000)
  const ui = await mount($, 'desktop')
  const text = await lineText(ui)
  expect(text).toContain('warm 40m')
  expect(text).toContain('91% hit')
  expect(text).not.toMatch(/[│▰▱]/)
  expect(await ui.find({ type: 'Text', text: 'cache' })).toBeDefined()
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
  expect((await ui.find({ type: 'Button' }))?.props).not.toMatchObject({ plain: true })
  await ui.press({ key: 'compact' })
  expect(calls).toEqual([1])
})

test('native prompt_cache wins: TTL, expiry, hit ratio and re-cache size come from Claude Code', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  isolate(on, {
    env: { CLAUDE_CODE_PROMPT_CACHE_TTL: '5m' },
    native: { warm: true, ttl: '1h', expires_at: (T0 + 40 * 60000) / 1000, hit_ratio: 0.91, misses: 2, recache_tokens_if_cold: 180000 },
  })
  const box = stepper(on)
  box.usage = usage('claude-opus-5-5', 170000, 10000, 500)
  await step($)
  await clock.advance(1000)
  const ui = await mount($)
  const text = await lineText(ui)
  expect(text).toContain('warm 40m ')
  expect(text).not.toContain('?')
  expect(text).toContain('91% hit')
  expect(text).toContain('180k cached')
  // 180000 x (1h write $8 - read $0.20) / 1e6 = $1.404
  expect(text).toContain('cold costs ≈ $1.40 extra')
  expect(text).toContain('cache │ warm 40m')
  const label = await ui.find({ type: 'Text', text: '  cache' })
  expect(label?.props).toMatchObject({ dimColor: true })
})

test('native data shows the band before any turn.step, including a pending re-cache size', async ($, on) => {
  mock.clock(on, { now: T0 })
  isolate(on, { native: { warm: true, ttl: '5m', expires_at: (T0 + 4 * 60000) / 1000, hit_ratio: null, recache_tokens_if_cold: null } })
  const ui = await mount($)
  const text = await lineText(ui)
  expect(text).toContain('warm 4m ')
  expect(text).toContain('size pending')
  expect(text).toContain('cold costs ≈ ? extra')
})

test('native cold shows the miss cause and no Compact button', async ($, on) => {
  mock.clock(on, { now: T0 })
  isolate(on, {
    native: { warm: false, ttl: '5m', expires_at: null, last_miss_cause: { causes: ['ttl_expired_5m'] }, recache_tokens_if_cold: 50000 },
  })
  const box = stepper(on)
  box.usage = usage('claude-opus-5-5', 40000, 10000, 0)
  await step($)
  const ui = await mount($)
  const text = await lineText(ui)
  expect(text).toContain('COLD')
  expect(text).toContain('ttl expired 5m')
  expect(await ui.find({ type: 'Button' })).toBeFalsy()
})

test('without the bridge, an env TTL beats the option and the countdown runs from the request start', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  isolate(on, { env: { CLAUDE_CODE_PROMPT_CACHE_TTL: '1h' } })
  let release: () => void = () => {}
  const reached = new Promise<void>(resolve => {
    release = resolve
  })
  on('turn.step', async function* () {
    release()
    await clock.sleep(2 * 60000)
    return {
      turnId: 't1',
      index: 0,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn',
      usage: usage('claude-opus-5-5', 1000, 100000, 0),
    }
  })
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })
  const done = (async () => {
    for await (const _ of stream) void _
    await stream.result
  })()
  await reached
  await clock.advance(2 * 60000)
  await done
  await clock.advance(8 * 60000)
  const ui = await mount($)
  // 60 minutes from the request start, of which 10 have passed
  expect(await lineText(ui)).toContain('warm 50m ')
})

test('a settings promptCacheTtl beats the fallback', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  isolate(on, { settings: { promptCacheTtl: '1h' } })
  const box = stepper(on)
  box.usage = usage('claude-opus-5-5', 1000, 1000, 0)
  await step($)
  await clock.advance(10 * 60000)
  const ui = await mount($)
  expect(await lineText(ui)).toContain('warm 50m ')
  await ui.unmount()
})

test('FORCE_PROMPT_CACHING_5M beats promptCacheTtl', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  isolate(on, { env: { FORCE_PROMPT_CACHING_5M: '1' }, settings: { promptCacheTtl: '1h' } })
  const box = stepper(on)
  box.usage = usage('claude-opus-5-5', 1000, 1000, 0)
  await step($)
  await clock.advance(2 * 60000)
  const ui = await mount($)
  expect(await lineText(ui)).toContain('warm 3m ')
})

test('with nothing native, the fallback is 5 minutes and is marked assumed', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  isolate(on)
  const box = stepper(on)
  box.usage = usage('claude-opus-5-5', 170000, 10000, 500)
  await step($)
  await clock.advance(2 * 60000)
  const ui = await mount($)
  const text = await lineText(ui)
  expect(text).toContain('warm 3m?')
  expect(text).toContain('94% reused')
  // 180000 x (5m write $5 - read $0.20) / 1e6 = $0.864
  expect(text).toContain('cold costs ≈ $0.86 extra')
  const answer = await $.command.run({ command: 'cache-clock', args: 'status' })
  expect(answer.text).toContain('ASSUMED')
  expect(answer.text).toContain('94%')
})

test('cacheMinutes 60 is only the assumed TTL, and it is still marked', { options: { cacheMinutes: '60' } }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  isolate(on)
  const box = stepper(on)
  box.usage = usage('claude-opus-5-5', 170000, 10000, 500)
  await step($)
  await clock.advance(8 * 60000)
  const text = await lineText(await mount($))
  expect(text).toContain('warm 52m?')
  expect(text).toContain('cold costs ≈ $1.40 extra')
})

test('a stale bridge file is ignored in favour of the marked estimate', async ($, on) => {
  mock.clock(on, { now: T0 })
  isolate(on, {
    writtenAt: T0 - 3 * 60 * 60 * 1000,
    native: { warm: true, ttl: '1h', expires_at: (T0 + 40 * 60000) / 1000, recache_tokens_if_cold: 180000 },
  })
  const box = stepper(on)
  box.usage = usage('claude-opus-5-5', 1000, 1000, 0)
  await step($)
  const text = await lineText(await mount($))
  expect(text).toContain('warm 5m?')
  expect(text).not.toContain('40m')
})

test('a subagent step counts in totals but does not restart the fallback countdown', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  isolate(on, { env: { FORCE_PROMPT_CACHING_5M: '1' } })
  const box = stepper(on)
  box.usage = usage('claude-opus-5-5', 1000, 100000, 0)
  await step($)
  await clock.advance(2 * 60000)
  box.usage = usage('claude-opus-5-5', 5000, 0, 0)
  await step($, 'agent-1')
  const ui = await mount($)
  expect(await lineText(ui)).toContain('warm 3m ')
  const answer = await $.command.run({ command: 'cache-clock', args: 'status' })
  expect(answer.text).toContain('reads 6.0k')
  expect(answer.text).toContain('writes 100k')
})

test('the Compact button calls $.session.compact once while warm, and the band clears after', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  isolate(on)
  const calls: unknown[] = []
  const toasts: string[] = []
  on('session.compact', async () => {
    calls.push(1)
    return { messages: [{ role: 'user', text: 'summary', toolUses: [] }], tokensBefore: 180000, tokensAfter: 9000 }
  })
  on('ui.toast', (_$: any, e: any) => {
    toasts.push(e.text)
    return { value: undefined } as never
  })
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['base'] }))
  const box = stepper(on)
  box.usage = usage('claude-opus-5-5', 170000, 10000, 500)
  await step($)
  await clock.advance(60000)
  const ui = await mount($)
  expect(calls).toHaveLength(0)
  await ui.press({ key: 'compact' })
  expect(calls).toEqual([1])
  expect(toasts.at(-1)).toBe('Compacted: 180k to 9.0k tokens.')
  await ui.unmount()
  const after = await lineText(await mount($))
  expect(after).not.toContain('CACHE')
  expect(after).toContain('base')
})

test('an unpriced model shows ≈ ? and a cold cache hides Compact', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  isolate(on)
  const box = stepper(on)
  box.usage = usage('claude-some-future-model', 1000, 1000, 0)
  await step($)
  await clock.advance(6 * 60000)
  const ui = await mount($)
  const text = await lineText(ui)
  expect(text).toContain('COLD')
  expect(text).toContain('cold costs ≈ ? extra')
  expect(await ui.find({ type: 'Button' })).toBeFalsy()
})

test('compaction drops a bridge file written before it', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  isolate(on, { native: { warm: true, ttl: '1h', expires_at: (T0 + 40 * 60000) / 1000, hit_ratio: 0.9, recache_tokens_if_cold: 10 } })
  on('classic.SessionStart', () => ({}))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['base'] }))
  await clock.advance(1000)
  await $.classic.SessionStart({ source: 'compact' })
  const text = await lineText(await mount($))
  expect(text).not.toContain('CACHE')
  expect(text).toContain('base')
})

test('a pre-expiry toast fires once from the fallback clock', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  isolate(on)
  const toasts: string[] = []
  on('ui.toast', (_$: any, e: any) => {
    toasts.push(e.text)
    return { value: undefined } as never
  })
  on('session.start', () => ({ cwd: '/work' }))
  on('command.register', () => ({ value: undefined }) as never)
  const box = stepper(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  box.usage = usage('claude-opus-5-5', 1000, 1000, 0)
  await step($)
  await clock.advance(4 * 60000)
  expect(toasts).toEqual(['Cache goes cold in 1m: 2.0k tokens cached, going cold costs ≈ $0.01 extra (estimate). Send anything to keep it warm.'])
})

test('session.start on one load arms a single timer', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  let reads = 0
  mock.env(on, { HOME: '/home/t' })
  on('session.id', () => ({ value: 's1' }) as never)
  on('settings.read', () => ({ value: {} }) as never)
  on('fs.read', () => {
    reads += 1
    return { deny: 'ENOENT' } as never
  })
  on('session.start', () => ({ cwd: '/work' }))
  on('command.register', () => ({ value: undefined }) as never)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  const before = reads
  await clock.advance(30000)
  expect(reads - before).toBe(1)
})

test("it stacks above another mod's band line instead of replacing it", async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  isolate(on)
  const box = stepper(on)
  on('ui.render', { component: 'AbovePrompt' }, async ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return Text({ children: 'other-mod line' })
  })
  box.usage = usage('claude-opus-5-5', 1000, 1000, 0)
  await step($)
  await clock.advance(1000)
  const text = await lineText(await mount($))
  expect(text).toContain('cache │')
  expect(text).toContain('other-mod line')
})

test('setup wraps the user status line and a second run reports it is already set up', async ($, on) => {
  const files = new Map<string, string>()
  files.set('/home/t/.claude/settings.json', JSON.stringify({ theme: 'dark', statusLine: { type: 'command', command: 'echo mine' } }))
  mock.env(on, { HOME: '/home/t' })
  on('session.version', () => ({ value: { version: '2.1.302', base: '2.1.302' } }) as never)
  on('settings.read', (_$: any, e: any) => ({ value: e.source === 'policy' ? {} : {} }) as never)
  on('process.run', () => ({ value: { exitCode: 0, stdout: 'v22.0.0', stderr: '' } }) as never)
  on('fs.exists', (_$: any, e: any) => ({ value: files.has(String(e.path)) }) as never)
  on('fs.read', (_$: any, e: any) => {
    const path = String(e.path)
    if (path.endsWith('/statusline/bridge.mjs')) return { value: 'bridge-bytes' } as never
    const text = files.get(path)
    if (text === undefined) return { deny: 'ENOENT' } as never
    return { value: text } as never
  })
  on('fs.write', (_$: any, e: any) => {
    files.set(String(e.path), String(e.text ?? e.contents ?? ''))
    return { value: undefined } as never
  })

  const created = await $.command.run({ command: 'cache-clock', args: 'setup' })
  expect(created.text).toContain('cache-clock bridge set up in /home/t/.claude/settings.json')
  const settings = JSON.parse(files.get('/home/t/.claude/settings.json') ?? '{}')
  expect(settings.theme).toBe('dark')
  expect(settings.statusLine.command).toContain('/home/t/.claude/cache-clock/bridge.mjs')
  expect(settings.statusLine.command).not.toContain('echo mine')
  const setupPath = [...files.keys()].find(path => path.includes('/setup-'))
  const saved = JSON.parse(files.get(setupPath ?? '') ?? '{}')
  expect(saved.wrapped).toBe('echo mine')
  expect(saved.previous).toEqual({ type: 'command', command: 'echo mine' })
  expect(files.get('/home/t/.claude/cache-clock/bridge.mjs')).toBe('bridge-bytes')
  const again = await $.command.run({ command: 'cache-clock', args: 'setup' })
  expect(again.text).toContain('already set up')
})

test('setup refuses Claude Code older than 2.1.251', async ($, on) => {
  on('session.version', () => ({ value: { version: '2.1.250', base: '2.1.250' } }) as never)
  const answer = await $.command.run({ command: 'cache-clock', args: 'setup' })
  expect(answer.text).toContain('2.1.250')
  expect(answer.text).toContain('Nothing changed')
})

test('setup does not edit a status line that comes from managed settings', async ($, on) => {
  mock.env(on, { HOME: '/home/t' })
  on('session.version', () => ({ value: { version: '2.1.302', base: '2.1.302' } }) as never)
  on('settings.read', (_$: any, e: any) => ({ value: e.source === 'policy' ? { statusLine: { type: 'command', command: 'echo managed' } } : {} }) as never)
  const answer = await $.command.run({ command: 'cache-clock', args: 'setup' })
  expect(answer.text).toContain('managed settings')
  expect(answer.text).toContain('Nothing changed')
})

test('remove restores the status line setup saved', async ($, on) => {
  const files = new Map<string, string>()
  mock.env(on, { HOME: '/home/t' })
  const settingsPath = '/home/t/.claude/settings.json'
  files.set(settingsPath, JSON.stringify({ theme: 'dark', statusLine: { type: 'command', command: 'node "/home/t/.claude/cache-clock/bridge.mjs" abcd1234' } }))
  on('fs.exists', (_$: any, e: any) => ({ value: files.has(String(e.path)) }) as never)
  on('fs.read', (_$: any, e: any) => {
    const path = String(e.path)
    if (path.includes('/setup-')) return { value: JSON.stringify({ previous: { type: 'command', command: 'echo mine' } }) } as never
    const text = files.get(path)
    if (text === undefined) return { deny: 'ENOENT' } as never
    return { value: text } as never
  })
  on('fs.write', (_$: any, e: any) => {
    files.set(String(e.path), String(e.text ?? ''))
    return { value: undefined } as never
  })
  const answer = await $.command.run({ command: 'cache-clock', args: 'remove' })
  expect(answer.text).toContain('removed')
  const settings = JSON.parse(files.get(settingsPath) ?? '{}')
  expect(settings.theme).toBe('dark')
  expect(settings.statusLine).toEqual({ type: 'command', command: 'echo mine' })
})
