import { expect, mock, test } from 'claude-code/testing'

import { countdown, estimateCache, longNumber, shortNumber, untilReset } from '../hooks/register'

const HOUR = 3_600_000

test('stima della cache: 1 ora in abbonamento, 5 minuti con chiave API o oltre il limite', () => {
  const sub = { rateLimits: [{ kind: 'five_hour', percentUsed: 40 }] }
  const over = { rateLimits: [{ kind: 'five_hour', percentUsed: 100 }] }
  const api = { rateLimits: [] }
  expect(estimateCache(null, 0, sub)).toEqual({ state: 'none' })
  expect(estimateCache(0, 10 * 60_000, sub).state).toBe('live')
  expect(estimateCache(0, 50 * 60_000, sub).state).toBe('low')
  expect(estimateCache(0, HOUR + 1, sub).state).toBe('expired')
  expect(estimateCache(0, 2 * 60_000, api).state).toBe('live')
  expect(estimateCache(0, 4.5 * 60_000, api).state).toBe('low')
  expect(estimateCache(0, 6 * 60_000, over).state).toBe('expired')
})

test('formati in italiano', () => {
  expect(shortNumber(1234)).toBe('1,2k')
  expect(shortNumber(2_000_000)).toBe('2M')
  expect(longNumber(1234567)).toBe('1.234.567')
  expect(countdown(54 * 60_000 + 12_000)).toBe('54:12')
  expect(untilReset(new Date(3 * 86_400_000 + 4 * HOUR).toISOString(), 0)).toBe('3g4h')
  expect(untilReset(new Date(2 * HOUR + 13 * 60_000).toISOString(), 0)).toBe('2h13m')
})

const USAGE = {
  startedAt: 0,
  context: { tokens: 82_000, window: 200_000, percent: 41 },
  rateLimits: [{ kind: 'five_hour', percentUsed: 23, resetsAt: new Date(2 * HOUR).toISOString() }],
  cost: { usd: 3.42 },
}

test('/token risponde con il riepilogo per esteso', async ($, on) => {
  mock.clock(on, { now: 0 })
  on('session.usage' as never, (() => ({ value: USAGE })) as never)
  const { text } = await $.command.run({ command: 'token', args: '' } as never)
  expect(text).toContain('Riepilogo della sessione')
  expect(text).toContain('Contesto')
  expect(text).toContain('Costo a prezzi API')
  expect(text).toContain('82.000 token su 200.000 (41%)')
  expect(text).toContain('$3,42')
})

test('la riga sopra la casella mostra cache, contesto e Handoff', async ($, on) => {
  mock.clock(on, { now: 0 })
  on('session.usage' as never, (() => ({ value: USAGE })) as never)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'barra-sessione',
      surface,
      component: 'AbovePrompt',
      props: {
        hasSurvey: false,
        isWorking: false,
        maxRows: 10,
        bodyColumns: 160,
        scroll: { offset: 0, bodyRows: 9 },
        view: {},
      } as never,
    })
    expect(await ui.find({ type: 'Text', text: /cache/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /contesto/ })).toBeDefined()
    expect(await ui.find({ key: 'handoff' })).toBeDefined()
    expect(await ui.find({ key: 'replay' })).toBeUndefined()
  }
})
