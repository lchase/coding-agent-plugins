export type MaskOptions = { isStrict: boolean; words: readonly string[] }

export const OFF_SCREEN = "Recording mode is on, so I'll keep that off screen"

export const POLICY = [
  'Recording mode is on: the user is screen-recording this session.',
  'Never print API keys, tokens, passwords, secret environment values, email addresses, phone numbers or the user\'s private words, whether they come from files, tool output or the user.',
  'Refer to them generically ("your API key", "the email address in the config") and, when you hold back something the user asked for, say: "' + OFF_SCREEN + '".',
  'Do not echo such values inside commands or code you show either; use placeholders.',
].join('\n')

const STRICT_POLICY = ' Also keep dollar amounts and home-folder paths off screen.'

export const policyText = (isStrict: boolean): string => (isStrict ? POLICY + STRICT_POLICY : POLICY)

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Order matters: key shapes first so a token is never half-eaten by a later rule.
const KEY_RULES: readonly (readonly [RegExp, string])[] = [
  [/\bsk-[A-Za-z0-9_-]{16,}/g, '[key]'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, '[key]'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, '[key]'],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/g, '[key]'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/g, 'Bearer [key]'],
  [
    /^([ \t]*(?:export[ \t]+)?[A-Za-z_][A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL)[A-Za-z0-9_]*[ \t]*=[ \t]*)\S.*$/gim,
    '$1[key]',
  ],
]

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g
// Needs a separator or a leading plus, so commit ids and plain numbers stay.
const PHONE = /(?<![\w.])(?:\+\d{1,3}[\s.-]?)?(?:\(\d{3}\)\s?|\d{3}[\s.-])\d{3}[\s.-]\d{4}(?![\w])|(?<![\w.])\+\d{1,3}[\s.-]\d{2,4}[\s.-]\d{3,4}(?:[\s.-]\d{2,4})?(?![\w])/g

const MONEY = /[$€£]\s?\d[\d,]*(?:\.\d+)?(?:\s?[kKmMbB]\b)?/g
const HOME = /(?:\/Users\/|\/home\/|[A-Za-z]:\\Users\\)[^\s/\\:"'`]+/g

export function mask(text: string, o: MaskOptions): string {
  let out = text
  for (const [re, to] of KEY_RULES) out = out.replace(re, to)
  out = out.replace(EMAIL, '[email]').replace(PHONE, '[phone]')
  for (const w of o.words) {
    if (w === '') continue
    out = out.replace(new RegExp(`(?<![A-Za-z0-9])${escape(w)}(?![A-Za-z0-9])`, 'gi'), '[private]')
  }
  if (o.isStrict) out = out.replace(MONEY, '[amount]').replace(HOME, '[home]')

  return out
}

/** Masks every string in a JSON-like value, leaving shape and other types alone. */
export function maskDeep(v: unknown, o: MaskOptions): unknown {
  if (typeof v === 'string') return mask(v, o)
  if (Array.isArray(v)) return v.map(x => maskDeep(x, o))
  if (typeof v === 'object' && v !== null) {
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v)) if (x !== undefined) out[k] = maskDeep(x, o)

    return out
  }

  return v
}

/** First letter and dots, so a list never shows the word itself. */
export const hint = (w: string): string => `${[...w][0] ?? ''}•••`

export const HELP = [
  '/rec            toggle recording mode',
  '/rec strict     on, and also hide $ amounts and home-folder paths',
  '/rec off        turn off',
  '/rec hide <w>   mask a private word',
  '/rec unhide <w> stop masking it',
  '/rec list       count and first letters',
  '/rec test <t>   preview masking',
].join('\n')
