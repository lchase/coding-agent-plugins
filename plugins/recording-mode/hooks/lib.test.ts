import { expect, test } from 'claude-code/testing'

import { hint, mask, maskDeep } from './lib'

const o = { isStrict: false, words: ['Acme'] }

test('keys and tokens become [key]', () => {
  expect(mask('use sk-ant-abcdefghijklmnop1234 now', o)).toBe('use [key] now')
  expect(mask('ghp_abcdefghijklmnopqrstuvwx', o)).toBe('[key]')
  expect(mask('xoxb-1234567890-abcdef', o)).toBe('[key]')
  expect(mask('Authorization: Bearer abc.def-ghi12345', o)).toBe('Authorization: Bearer [key]')
  expect(mask('export OPENAI_API_KEY=abc123\nPORT=3000', o)).toBe('export OPENAI_API_KEY=[key]\nPORT=3000')
})

test('emails, phones and private words', () => {
  expect(mask('mail me at jo.doe@example.com', o)).toBe('mail me at [email]')
  expect(mask('call (415) 555-0134 or +1 415-555-0134', o)).toBe('call [phone] or [phone]')
  expect(mask('acme and ACME but not Acmeville', o)).toBe('[private] and [private] but not Acmeville')
})

test('commit ids and code are left alone', () => {
  const s = 'commit 8f1ccaf1234567 const x = 42; version 1.2.3 at 1234567890'
  expect(mask(s, { isStrict: true, words: [] })).toBe(s)
})

test('strict hides amounts and home paths, normal does not', () => {
  const s = 'cost $1,250.50 in /Users/lawrencechase/ws'
  expect(mask(s, o)).toBe(s)
  expect(mask(s, { isStrict: true, words: [] })).toBe('cost [amount] in [home]/ws')
})

test('maskDeep keeps shape and non-strings', () => {
  expect(maskDeep({ a: 'x@y.io', n: 3, l: ['sk-abcdefghijklmnop1234'], u: undefined }, o)).toEqual({
    a: '[email]',
    n: 3,
    l: ['[key]'],
  })
})

test('hint shows the first letter only', () => {
  expect(hint('Acme')).toBe('A•••')
})
