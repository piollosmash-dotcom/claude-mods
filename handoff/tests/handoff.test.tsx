import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

// origin e presentation li timbra il motore.
const HANDOFF = { command: 'handoff', args: '' } as never

const avvisi = (on: On) => {
  mock.store(on)
  const orologio = mock.clock(on)
  const ricevuti: string[] = []
  const attese: Array<[RegExp, () => void]> = []
  on('ui.toast', async ($, e) => {
    ricevuti.push(e.text)
    for (const [regola, fatto] of attese) if (regola.test(e.text)) fatto()
    return { value: undefined }
  })
  on('session.usage', async () => ({ value: { startedAt: 0, context: { window: 200000, percent: 40 }, rateLimits: [] } }))
  const aspetta = (regola: RegExp) =>
    new Promise<void>(fatto => {
      if (ricevuti.some(t => regola.test(t))) fatto()
      else attese.push([regola, fatto])
    })
  const finito = async (regola: RegExp) => {
    await aspetta(regola)
    await orologio.settle()
  }
  return { ricevuti, aspetta: finito }
}

test('/handoff riassume, pulisce la chat e mette la bozza nella casella', async ($, on) => {
  const ordine: string[] = []
  let bozza = ''
  const { aspetta } = avvisi(on)

  on('model.fork', async () => {
    ordine.push('fork')
    return { value: { isAnswered: true, text: '# Handoff sessione — prova\n', usage: {} } } as never
  })
  on('command.run', { command: 'clear' }, async () => {
    ordine.push('clear')
    return { text: '' }
  })
  on('prompt.fill', async ($, e) => {
    ordine.push('fill')
    bozza = e.text
    return { isFilled: true, text: e.text } as never
  })

  await $.command.run(HANDOFF)
  await aspetta(/Handoff pronto/)

  expect(ordine).toEqual(['fork', 'clear', 'fill'])
  expect(bozza).toBe('# Handoff sessione — prova')
})

test('senza conversazione non pulisce nulla', async ($, on) => {
  let pulito = false
  const { aspetta } = avvisi(on)
  on('model.fork', async () => ({ value: { isAnswered: false, reason: 'nothing-to-fork' } }) as never)
  on('command.run', { command: 'clear' }, async () => {
    pulito = true
    return { text: '' }
  })

  await $.command.run(HANDOFF)
  await aspetta(/Handoff annullato/)

  expect(pulito).toBe(false)
})

test('il pulsante Handoff compare sopra la casella', async ($, on) => {
  mock.store(on)
  on('session.usage', async () => ({ value: { startedAt: 0, context: { window: 200000, percent: 62 }, rateLimits: [] } }))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'handoff', surface, component: 'AbovePrompt', props: { hasSurvey: false } } as never)
    expect(await ui.find({ key: 'handoff' })).toBeDefined()
    await ui.unmount()
  }
})
