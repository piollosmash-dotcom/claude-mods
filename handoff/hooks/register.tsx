import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Fase } from '../types'

const fase = atom({ plugin: 'handoff', key: 'fase' } as const, 'pronto' as Fase)
const percentuale = atom({ plugin: 'handoff', key: 'percentuale' } as const, null)
const inAttesa = atom({ plugin: 'handoff', key: 'inAttesa' } as const, false)

const ULTIMO = 'ultimo-handoff'
// Resta vero dal /clear fino al primo invio: dopo il /clear la sessione cambia, lo store no.
const ATTESA = 'handoff-in-attesa'

export const PROMPT_HANDOFF = `Scrivi un prompt di passaggio di consegne (handoff) per una NUOVA chat che riparte da zero e non sa nulla di questa conversazione.
Rispondi SOLO con il prompt, in italiano, in Markdown, senza preamboli né commenti finali. Usa questa struttura:

# Handoff sessione — <titolo breve>

## Dove eravamo
Obiettivo dell'utente, contesto e vincoli emersi (preferenze, regole da rispettare).

## Decisioni prese e cosa è stato fatto
Elenco puntato: decisioni con il loro perché, modifiche fatte, comandi eseguiti, risultati.

## File e risorse chiave
Percorsi, branch, URL, nomi di comandi o configurazioni che servono per continuare.

## Stato attuale
Cosa funziona, cosa è a metà, processi ancora in corso, errori aperti.

## Prossimi passi
Lista numerata e concreta di cosa fare adesso.

## Domande aperte
Cose da chiarire con l'utente, se ce ne sono.

Sii denso e concreto: niente ripetizioni, niente dettagli che non servono a continuare. Chiudi con una riga "Continua da qui." rivolta al nuovo assistente.`

type Esito = { ok: boolean; messaggio: string }

async function aggiornaContesto($: EngineInterface) {
  const { context } = await $.session.usage()
  await update($, percentuale, () => context.percent ?? null)
}

async function riempiBozza($: EngineInterface): Promise<boolean> {
  const ultimo = await $.store.get(ULTIMO)
  if (typeof ultimo !== 'string') return false
  const riempito = await $.prompt.fill({ text: ultimo, mode: 'replace' })
  if (riempito.isFilled) $.ui.toast('Handoff pronto: rileggi la bozza e premi Invio.')
  return riempito.isFilled
}

// Il /clear svuota la casella dopo aver finito: la bozza va messa quando la nuova chat è su.
async function riempiDopoClear($: EngineInterface) {
  for (const attesa of [300, 700, 1500]) {
    await $.clock.sleep(attesa)
    if (await riempiBozza($)) return true
  }
  return false
}

async function eseguiHandoff($: EngineInterface): Promise<Esito> {
  if ((await read($, fase)) !== 'pronto') {
    return { ok: false, messaggio: 'Un handoff è già in corso.' }
  }
  await update($, fase, () => 'riassumo')
  try {
    $.ui.toast('Handoff: scrivo il riassunto della sessione…')
    const risposta = await $.model.fork({ prompt: PROMPT_HANDOFF })
    if (!risposta.isAnswered) {
      const motivo =
        risposta.reason === 'nothing-to-fork'
          ? 'non c’è ancora una conversazione da riassumere'
          : `nessuna risposta (${risposta.reason})`
      $.ui.toast(`Handoff annullato: ${motivo}.`)
      return { ok: false, messaggio: `Handoff annullato: ${motivo}.` }
    }
    const riassunto = risposta.text.trim()
    await $.store.set(ULTIMO, riassunto)
    await $.store.set(ATTESA, true)
    await update($, inAttesa, () => true)

    await update($, fase, () => 'pulisco')
    await $.command.run({ command: 'clear' })
    if (!(await riempiDopoClear($))) {
      $.ui.toast('Chat pulita: premi «Incolla handoff» o usa /handoff ultimo.')
      return { ok: false, messaggio: 'Bozza non inserita: premi «Incolla handoff» o usa /handoff ultimo.' }
    }
    return { ok: true, messaggio: 'Handoff pronto nella casella.' }
  } catch (errore) {
    const testo = errore instanceof Error ? errore.message : String(errore)
    $.ui.toast(`Handoff non riuscito: ${testo}`)
    return { ok: false, messaggio: `Handoff non riuscito: ${testo}` }
  } finally {
    await update($, fase, () => 'pronto')
    await aggiornaContesto($)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'handoff',
      description: 'Riassume la sessione, pulisce la chat e mette il riassunto come bozza',
      argumentHint: '[ultimo]',
    })
    await aggiornaContesto($)

    return next(e)
  })

  on('command.run', { command: 'handoff' }, async ($, e) => {
    if ((e.args ?? '').trim() === 'ultimo') {
      const ultimo = await $.store.get(ULTIMO)
      if (typeof ultimo !== 'string') {
        return { text: 'Nessun handoff salvato finora.' }
      }
      // La casella si libera solo quando il comando ha finito: la bozza va messa dopo.
      void $.clock.sleep(200).then(() => riempiBozza($))

      return { text: 'Ultimo handoff in arrivo nella casella.' }
    }
    // Il /clear va lanciato fuori da questo hook: il comando non può aspettare un altro comando.
    void eseguiHandoff($)

    return { text: 'Handoff avviato: scrivo il riassunto, poi pulisco la chat e lo metto nella casella.' }
  })

  // Rete di sicurezza: se il riempimento lanciato prima del /clear si perde, lo rifà la nuova chat.
  on('classic.SessionStart', async ($, e, next) => {
    const risultato = await next(e)
    if (e.source === 'clear') {
      void $.store
        .get(ATTESA)
        .then(async attesa => {
          if (attesa !== true) return
          await update($, inAttesa, () => true)
          await riempiDopoClear($)
        })
        .catch(() => undefined)
    }

    return risultato
  })

  // Inviata la bozza (o un altro messaggio), il pulsante «Incolla handoff» sparisce.
  on('prompt.submit', async ($, e, next) => {
    try {
      if (await read($, inAttesa)) {
        await update($, inAttesa, () => false)
        void $.store.delete(ATTESA).catch(() => undefined)
      }
    } catch {
      // Un errore qui non deve mai bloccare l'invio.
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const risultato = await next(e)
    await aggiornaContesto($)

    return risultato
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }
    const { Box, Button, Text } = $.ui.resolve(e)
    const stato = await read($, fase)
    const pieno = await read($, percentuale)
    const bozzaInAttesa = await read($, inAttesa)
    const colore = pieno === null ? undefined : pieno >= 75 ? 'red' : pieno >= 50 ? 'yellow' : 'green'
    const etichetta =
      stato === 'riassumo' ? 'Riassumo…' : stato === 'pulisco' ? 'Pulisco…' : 'Handoff'

    return (
      <Box flexDirection="row">
        {pieno !== null && (
          <Text color={colore}>contesto {Math.round(pieno)}%{pieno >= 50 ? ' · conviene un handoff ' : ' '}</Text>
        )}
        <Button
          key="handoff"
          label={etichetta}
          hotkey="h"
          onPress={() => {
            if (e.props.isWorking) $.ui.toast('Aspetta che Claude finisca il turno.')
            else if (stato === 'pronto') void eseguiHandoff($)
          }}
        />
        {bozzaInAttesa && stato === 'pronto' && (
          <Button key="incolla" label="Incolla handoff" hotkey="i" onPress={() => void riempiBozza($)} />
        )}
      </Box>
    )
  })
}
