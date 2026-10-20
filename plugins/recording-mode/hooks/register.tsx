import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Settings } from '../types'
import { HELP, hint, mask, maskDeep, policyText } from './lib'
import type { MaskOptions } from './lib'

const DEFAULTS: Settings = { isOn: false, isStrict: false }
const settings = atom({ plugin: 'recording-mode', key: 'settings' } as const, DEFAULTS)

const isSettings = (v: unknown): v is Settings =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as Settings).isOn === 'boolean' &&
  typeof (v as Settings).isStrict === 'boolean'

const loadWords = async ($: EngineInterface): Promise<string[]> => {
  const raw = await $.store.get('words')

  return Array.isArray(raw) ? raw.filter((w): w is string => typeof w === 'string') : []
}

/** The masking options, or null while recording mode is off. */
const optionsOf = async ($: EngineInterface): Promise<MaskOptions | null> => {
  const cfg = ((await read($, settings)) as Settings | undefined) ?? DEFAULTS
  if (!cfg.isOn) return null

  return { isStrict: cfg.isStrict, words: await loadWords($) }
}

function show($: EngineInterface, cfg: Settings) {
  $.ui.status(cfg.isOn ? (cfg.isStrict ? '● REC strict' : '● REC') : undefined)
}

async function apply($: EngineInterface, cfg: Settings) {
  await update($, settings, () => cfg)
  await $.store.set('settings', cfg)
  show($, cfg)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const saved = await $.store.get('settings')
    if (isSettings(saved)) {
      await update($, settings, () => saved)
      if (saved.isOn) {
        show($, saved)
        $.ui.toast('Recording mode is still ON')
      }
    }
    await $.command.register({
      name: 'rec',
      description: 'Recording mode: mask secrets on screen',
      argumentHint: 'strict | off | hide <word> | unhide <word> | list | test <text>',
    })

    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)
    const cfg = ((await read($, settings)) as Settings | undefined) ?? DEFAULTS
    if (!cfg.isOn) return result

    return {
      sections: [
        ...result.sections,
        { id: 'recording-mode:policy', text: policyText(cfg.isStrict), scope: 'session' as const },
      ],
    }
  })

  on('command.run', { command: 'rec' }, async ($, e) => {
    const [head = '', ...rest] = e.args.trim().split(/\s+/)
    const verb = head.toLowerCase()
    const arg = rest.join(' ').trim()
    const cfg = ((await read($, settings)) as Settings | undefined) ?? DEFAULTS

    if (verb === '' || verb === 'on') {
      const next: Settings = verb === '' && cfg.isOn ? { ...cfg, isOn: false } : { isOn: true, isStrict: false }
      await apply($, next)
      $.ui.toast(next.isOn ? 'Recording mode ON' : 'Recording mode OFF')

      return { text: next.isOn ? 'Recording mode is on.' : 'Recording mode is off.' }
    }
    if (verb === 'strict') {
      await apply($, { isOn: true, isStrict: true })
      $.ui.toast('Recording mode ON (strict)')

      return { text: 'Recording mode is on, strict: amounts and home paths hidden too.' }
    }
    if (verb === 'off') {
      await apply($, { ...cfg, isOn: false })
      $.ui.toast('Recording mode OFF')

      return { text: 'Recording mode is off.' }
    }
    if (verb === 'hide' || verb === 'unhide') {
      if (arg === '') return { text: `Usage: /rec ${verb} <word>` }
      const words = await loadWords($)
      const has = words.some(w => w.toLowerCase() === arg.toLowerCase())
      if (verb === 'hide') {
        if (!has) await $.store.set('words', [...words, arg])

        return { text: `Hiding ${hint(arg)} (${has ? words.length : words.length + 1} private words).` }
      }
      await $.store.set('words', words.filter(w => w.toLowerCase() !== arg.toLowerCase()))

      return { text: has ? `Unhid ${hint(arg)}.` : `${hint(arg)} was not hidden.` }
    }
    if (verb === 'list') {
      const words = await loadWords($)

      return {
        text: words.length === 0 ? 'No private words.' : `${words.length} private words: ${words.map(hint).join(' ')}`,
      }
    }
    if (verb === 'test') {
      const words = await loadWords($)
      // Preview shows what strict-or-not would look like for the current setting, masked even while off.
      const out = mask(e.args.trim().slice(head.length).trim(), { isStrict: cfg.isStrict, words })

      return { text: `Masked: ${out}` }
    }

    return { text: HELP }
  })

  // Display only: each site rewrites the props the engine draws, never what the model read.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const o = await optionsOf($)
    if (o === null) return next(e)

    return next({ ...e, props: { ...e.props, text: mask(e.props.text, o) } })
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const o = await optionsOf($)
    if (o === null) return next(e)

    return next({ ...e, props: { ...e.props, text: mask(e.props.text, o) } })
  })

  on('ui.render', { component: 'CommandOutput' }, async ($, e, next) => {
    const o = await optionsOf($)
    if (o === null) return next(e)

    return next({ ...e, props: { ...e.props, text: mask(e.props.text, o) } })
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const o = await optionsOf($)
    if (o === null) return next(e)

    return next({ ...e, props: { ...e.props, input: maskDeep(e.props.input, o) } })
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    const o = await optionsOf($)
    if (o === null) return next(e)

    return next({ ...e, props: { ...e.props, output: maskDeep(e.props.output, o) } })
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const cfg = ((await read($, settings)) as Settings | undefined) ?? DEFAULTS
    if (e.props.hasSurvey || !cfg.isOn) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    // label column is 7 wide, the length of 'handoff', so stacked bands line up
    const chip = (
      <Box>
        <Text dimColor>{'rec'.padStart(7)}</Text>
        <Text dimColor>{' │ '}</Text>
        <Text bold color="#f87171">● </Text>
        <Text bold>{cfg.isStrict ? 'strict' : 'recording'}</Text>
        <Text dimColor>{cfg.isStrict ? ' · secrets, amounts and home paths masked' : ' · secrets masked on screen'}</Text>
      </Box>
    )
    const below = await next(e)

    return below ? (
      <Box flexDirection="column">
        {chip}
        {below}
      </Box>
    ) : (
      chip
    )
  })
}
