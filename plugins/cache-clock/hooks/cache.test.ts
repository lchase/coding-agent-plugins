import { expect, test } from 'claude-code/testing'

import { canonical, coldCost, coldPenalty, rates } from './cache'

test('Sonnet 5.5 cache reads are $0.10 per million tokens', () => {
  const r = rates('claude-sonnet-5-5', 1000)
  expect(r).toEqual({ input: 2, write5: 2.5, write60: 4, read: 0.1 })
  // 1M cached tokens, 5-minute write $2.50 minus read $0.10
  expect(coldPenalty('claude-sonnet-5-5', 1_000_000, 1_000_000, 5)).toBe(2.4)
  expect(coldCost('claude-sonnet-5-5', 1_000_000, 1_000_000, 5)).toBe(2.5)
})

test('Bedrock and Vertex model ids use the same rate card', () => {
  expect(canonical('us.anthropic.claude-sonnet-4-5-20250929-v1:0')).toBe('claude-sonnet-4-5')
  expect(canonical('global.anthropic.claude-opus-4-6-v1:0')).toBe('claude-opus-4-6')
  expect(canonical('anthropic.claude-3-5-haiku-20241022-v1:0')).toBe('claude-3-5-haiku')
  expect(canonical('claude-sonnet-4-5@20250929')).toBe('claude-sonnet-4-5')
  expect(canonical('claude-sonnet-5-5[1m]')).toBe('claude-sonnet-5-5')
  expect(rates('eu.anthropic.claude-sonnet-5-5[1m]', 1000)?.read).toBe(0.1)
  expect(rates('claude-opus-4-5@20251101', 1000)?.read).toBe(0.5)
  expect(rates('claude-3-5-haiku-20241022', 1000)?.read).toBe(0.08)
})

test('Haiku 5.5 switches cards above 100k prompt tokens', () => {
  expect(rates('claude-haiku-5-5', 100000)?.input).toBe(0.1)
  expect(rates('claude-haiku-5-5', 100001)?.input).toBe(0.5)
})

test('an unknown model stays unpriced', () => {
  expect(rates('claude-some-future-model', 1000)).toBe(null)
  expect(coldPenalty('claude-some-future-model', 1000, 1000, 5)).toBe(null)
})
