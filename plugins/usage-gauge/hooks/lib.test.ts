import { expect, test } from 'claude-code/testing'

import {
  addReading,
  bar,
  colorFor,
  duration,
  paceOutMs,
  paceText,
  parseWarn,
  resetText,
  windowLabel,
} from './lib'

const MIN = 60_000

test('bar fills proportionally', () => {
  expect(bar(34, 6)).toBe('▰▰▱▱▱▱')
  expect(bar(83, 6)).toBe('▰▰▰▰▰▱')
  expect(bar(0, 6)).toBe('▱▱▱▱▱▱')
  expect(bar(130, 6)).toBe('▰▰▰▰▰▰')
})

test('colour bands: green under 60, amber 60 to 85, red over 85', () => {
  expect(colorFor(59.9)).toBe('#4ade80')
  expect(colorFor(60)).toBe('#fbbf24')
  expect(colorFor(85)).toBe('#fbbf24')
  expect(colorFor(85.1)).toBe('#f87171')
})

test('windows are named by kind, unknown kinds by their own name', () => {
  expect(windowLabel('five_hour')).toBe('5h')
  expect(windowLabel('seven_day')).toBe('week')
  expect(windowLabel('spend_limit')).toBe('spend_limit')
})

test('reset text: countdown within a day, weekday and hour after', () => {
  const now = Date.parse('2026-10-12T10:00:00Z')
  const soon = { kind: 'five_hour', percentUsed: 1, resetsAt: new Date(now + 131 * MIN).toISOString() }
  expect(resetText(soon, now)).toBe('2h11m')
  const later = { kind: 'seven_day', percentUsed: 1, resetsAt: new Date(now + 3 * 86_400_000).toISOString() }
  expect(resetText(later, now)).toMatch(/^[A-Z][a-z]{2} \d{1,2}(:\d\d)?(am|pm)$/)
  expect(resetText({ kind: 'x', percentUsed: 1 }, now)).toBeUndefined()
  expect(duration(45 * MIN)).toBe('45m')
})

test('pace needs two readings about five minutes apart', () => {
  const reset = new Date(4 * 3_600_000).toISOString()
  const one = addReading(undefined, 30, 0)
  expect(paceOutMs(one, reset, 0)).toBeUndefined()
  const tooClose = addReading(one, 32, 2 * MIN)
  expect(paceOutMs(tooClose, reset, 2 * MIN)).toBeUndefined()
  const two = addReading(one, 40, 5 * MIN)
  const out = paceOutMs(two, reset, 5 * MIN)
  // 10 points per 5 min: 60 left lasts 30 more minutes
  expect(Math.round((out ?? 0) / MIN)).toBe(30)
  expect(paceText(out ?? 0)).toBe('~30m')
})

test('no pace warning when the window resets before it runs out', () => {
  const reset = new Date(20 * MIN).toISOString()
  const r = addReading(addReading(undefined, 30, 0), 31, 5 * MIN)
  expect(paceOutMs(r, reset, 5 * MIN)).toBeUndefined()
})

test('a drop in percent restarts the history', () => {
  const r = addReading(addReading(undefined, 90, 0), 5, MIN)
  expect(r).toEqual([{ pct: 5, t: MIN }])
})

test('warn arguments are validated', () => {
  expect(parseWarn('warn 70 95')).toEqual({ a: 70, b: 95 })
  expect(typeof parseWarn('warn 95 70')).toBe('string')
  expect(typeof parseWarn('warn 70')).toBe('string')
  expect(typeof parseWarn('warn x y')).toBe('string')
})
