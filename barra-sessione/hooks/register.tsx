import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionUsage } from 'claude-code'

import type { Tokens } from '../types'

const NO_TOKENS: Tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

const lastRequestAt = atom(
  { plugin: 'barra-sessione', key: 'lastRequestAt' } as const,
  null,
)
const tokens = atom({ plugin: 'barra-sessione', key: 'tokens' } as const, NO_TOKENS)
const hasReplay = atom({ plugin: 'barra-sessione', key: 'hasReplay' } as const, false)
const isHandingOff = atom(
  { plugin: 'barra-sessione', key: 'isHandingOff' } as const,
  false,
)

const MINUTE = 60_000
const HOUR = 60 * MINUTE

const HANDOFF_PROMPT = `Scrivi un handoff di questa sessione, in italiano, perché un agente nuovo possa continuare il lavoro senza perdere il filo dopo un /clear.
Usa queste sezioni, in Markdown, saltando quelle vuote:
## Obiettivo
## Decisioni prese
## Modifiche fatte (file e cosa è cambiato)
## File chiave
## Processi in esecuzione
## Comandi di verifica
## Cose rimandate
## Domande aperte
## Prossimo passo
Sii concreto e sintetico: percorsi esatti, comandi esatti, niente preamboli. Rispondi solo con l'handoff.`

// --- formattazione -----------------------------------------------------------

/** 1234 → "1,2k", 1234567 → "1,2M", alla maniera italiana. */
export function shortNumber(n: number): string {
  const comma = (x: number) => x.toFixed(1).replace(/\.0$/, '').replace('.', ',')
  if (n >= 1_000_000) return `${comma(n / 1_000_000)}M`
  if (n >= 1_000) return `${comma(n / 1_000)}k`
  return String(Math.round(n))
}

/** Il numero intero con i punti delle migliaia: 1234567 → "1.234.567". */
export function longNumber(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

export function euroStyleDollars(usd: number): string {
  return `$${usd.toFixed(2).replace('.', ',')}`
}

/** Un conto alla rovescia breve: "54:12", "1:03:20". */
export function countdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (x: number) => String(x).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/** Il tempo al rinnovo: "2h13m", "3g4h", "12m". */
export function untilReset(resetsAt: string | undefined, now: number): string | undefined {
  if (resetsAt === undefined) return undefined
  const ms = Date.parse(resetsAt) - now
  if (Number.isNaN(ms)) return undefined
  if (ms <= 0) return 'ora'
  const minutes = Math.ceil(ms / MINUTE)
  const d = Math.floor(minutes / 1440)
  const h = Math.floor((minutes % 1440) / 60)
  const m = minutes % 60
  if (d > 0) return `${d}g${h}h`
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}m`
  return `${m}m`
}

const LIMIT_NAMES: Record<string, string> = {
  five_hour: '5h',
  seven_day: 'sett.',
  spend_limit: 'spesa',
}

// --- la stima della cache ----------------------------------------------------

export type CacheEstimate =
  | { state: 'none' }
  | { state: 'live' | 'low' | 'expired'; remainingMs: number; ttlMs: number; why: string }

/**
 * Un'ora con un abbonamento sotto i limiti, cinque minuti con la chiave API
 * (nessuna finestra di limite riportata) o con una finestra al 100%.
 */
export function cacheTtl(usage: Pick<SessionUsage, 'rateLimits'>): { ttlMs: number; why: string } {
  const limits = usage.rateLimits
  if (limits.length === 0) return { ttlMs: 5 * MINUTE, why: 'chiave API: TTL 5 minuti' }
  if (limits.some(l => l.percentUsed >= 100)) {
    return { ttlMs: 5 * MINUTE, why: 'oltre il limite: TTL 5 minuti' }
  }
  return { ttlMs: HOUR, why: 'abbonamento sotto i limiti: TTL 1 ora' }
}

export function estimateCache(
  last: number | null,
  now: number,
  usage: Pick<SessionUsage, 'rateLimits'>,
): CacheEstimate {
  if (last === null) return { state: 'none' }
  const { ttlMs, why } = cacheTtl(usage)
  const remainingMs = last + ttlMs - now
  if (remainingMs <= 0) return { state: 'expired', remainingMs: 0, ttlMs, why }
  const lowAt = Math.max(MINUTE, ttlMs / 5)
  return { state: remainingMs <= lowAt ? 'low' : 'live', remainingMs, ttlMs, why }
}

const CACHE_COLOR = { live: 'success', low: 'warning', expired: 'error' } as const

// --- il riepilogo --------------------------------------------------------------

export type Summary = {
  cache: CacheEstimate
  usage: SessionUsage
  tokens: Tokens
  now: number
}

async function summarize($: EngineInterface): Promise<Summary> {
  const [usage, last, used, now] = await Promise.all([
    $.session.usage(),
    read($, lastRequestAt),
    read($, tokens),
    $.clock.now(),
  ])
  return { cache: estimateCache(last, now, usage), usage, tokens: used, now }
}

export function totalTokens(t: Tokens): number {
  return t.input + t.output + t.cacheRead + t.cacheWrite
}

function cacheLabel(cache: CacheEstimate): string {
  if (cache.state === 'none') return 'cache —'
  if (cache.state === 'expired') return 'cache scaduta'
  return `cache ${countdown(cache.remainingMs)}`
}

function contextLabel(usage: SessionUsage): string {
  const { tokens: used, window, percent } = usage.context
  if (used === undefined) return `contesto —/${shortNumber(window)}`
  return `contesto ${shortNumber(used)}/${shortNumber(window)} (${percent ?? Math.round((used / window) * 100)}%)`
}

function limitLabels(usage: SessionUsage, now: number): string[] {
  return usage.rateLimits.map(l => {
    const name = LIMIT_NAMES[l.kind] ?? l.kind
    const reset = untilReset(l.resetsAt, now)
    const pct = String(l.percentUsed).replace('.', ',')
    return reset === undefined ? `${name} ${pct}%` : `${name} ${pct}% ↻${reset}`
  })
}

function costLabel(usage: SessionUsage): string {
  return usage.cost === undefined ? '' : ` · ${euroStyleDollars(usage.cost.usd)}`
}

/** Il riepilogo per esteso di /token. */
export function longReport(s: Summary): string {
  const { usage, cache, tokens: t, now } = s
  const lines: string[] = ['**Riepilogo della sessione**', '']

  if (cache.state === 'none') {
    lines.push('- **Cache**: nessuna richiesta ancora in questa sessione.')
  } else {
    const ttl = cache.ttlMs >= HOUR ? '1 ora' : '5 minuti'
    const left =
      cache.state === 'expired' ? 'scaduta' : `scade tra ${countdown(cache.remainingMs)}`
    lines.push(`- **Cache**: ${left} (stima: ${cache.why}; durata ${ttl} dall'ultima richiesta).`)
  }

  const ctx = usage.context
  lines.push(
    ctx.tokens === undefined
      ? `- **Contesto**: nessuna lettura ancora; finestra di ${longNumber(ctx.window)} token.`
      : `- **Contesto**: ${longNumber(ctx.tokens)} token su ${longNumber(ctx.window)} (${ctx.percent ?? Math.round((ctx.tokens / ctx.window) * 100)}%).`,
  )

  if (usage.rateLimits.length === 0) {
    lines.push('- **Limiti**: nessuna finestra riportata (chiave API, o nessuna richiesta ancora).')
  } else {
    for (const l of usage.rateLimits) {
      const name =
        l.kind === 'five_hour' ? 'Limite 5 ore' : l.kind === 'seven_day' ? 'Limite settimanale' : `Limite ${l.kind}`
      const reset = untilReset(l.resetsAt, now)
      const when =
        l.resetsAt === undefined
          ? ''
          : ` — si rinnova tra ${reset} (${new Date(l.resetsAt).toISOString().slice(0, 16).replace('T', ' ')} UTC)`
      lines.push(`- **${name}**: ${String(l.percentUsed).replace('.', ',')}% usato${when}.`)
    }
  }

  lines.push(
    `- **Token della sessione**: ${longNumber(totalTokens(t))} in tutto` +
      ` — input ${longNumber(t.input)}, output ${longNumber(t.output)},` +
      ` letti dalla cache ${longNumber(t.cacheRead)}, scritti in cache ${longNumber(t.cacheWrite)}.`,
  )
  lines.push(
    usage.cost === undefined
      ? '- **Costo a prezzi API**: non disponibile in questo host.'
      : `- **Costo a prezzi API**: ${euroStyleDollars(usage.cost.usd)}.`,
  )
  return lines.join('\n')
}

// --- handoff -------------------------------------------------------------------

async function handoff($: EngineInterface): Promise<void> {
  if (await read($, isHandingOff)) return
  await update($, isHandingOff, () => true)
  try {
    $.ui.toast('Handoff: scrivo il riassunto della sessione…')
    const reply = await $.model.fork({ prompt: HANDOFF_PROMPT })
    if (!reply.isAnswered) {
      $.ui.toast(`Handoff non riuscito (${reply.reason}): la chat non è stata pulita.`)
      return
    }
    const summary = reply.text.trim()
    try {
      await $.command.run({ command: 'clear' })
    } catch {
      await $.prompt.fill({ text: summary })
      $.ui.toast('Non ho potuto pulire la chat: riassunto nella casella, lancia /clear e incollalo.')
      return
    }
    const filled = await $.prompt.fill({ text: summary })
    $.ui.toast(
      filled.isFilled
        ? 'Chat pulita: il riassunto è nella casella come bozza.'
        : 'Chat pulita, ma la casella non ha preso la bozza.',
    )
  } finally {
    await update($, isHandingOff, () => false)
  }
}

async function checkReplay($: EngineInterface): Promise<void> {
  const commands = await $.command.list()
  const found = commands.some(
    c => c.plugin?.split('@')[0] === 'replay-theater' || (c.name === 'replay' && c.source === 'plugin'),
  )
  if (found !== (await read($, hasReplay))) await update($, hasReplay, () => found)
}

// --- registrazione --------------------------------------------------------------

export const register: Register = on => {
  let stopTick: (() => void) | undefined

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'token',
      description: 'Riepilogo per esteso: cache, contesto, limiti, token e costo della sessione',
    })
    await checkReplay($)
    stopTick?.()
    // Il conto alla rovescia della cache: un ridisegno al secondo.
    const tick = $.clock.every(1000, () => $.ui.invalidate('ui.render'))
    // replay-theater può essere installato a sessione avviata.
    const replayCheck = $.clock.every(60_000, () => void checkReplay($))
    stopTick = () => {
      tick.cancel()
      replayCheck.cancel()
    }
    return next(e)
  })

  // Ogni risposta del modello nel loop principale rinnova la cache.
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    if (e.agentId === undefined) {
      const now = await $.clock.now()
      await update($, lastRequestAt, () => now)
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const u = e.usage
    if (u !== undefined) {
      await update($, tokens, t => ({
        input: t.input + u.input_tokens,
        output: t.output + u.output_tokens,
        cacheRead: t.cacheRead + u.cache_read_input_tokens,
        cacheWrite: t.cacheWrite + u.cache_creation_input_tokens,
      }))
    }
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await update($, tokens, () => NO_TOKENS)
      await update($, lastRequestAt, () => null)
    }
    return next(e)
  })

  on('command.run', { command: 'token' }, async $ => ({ text: longReport(await summarize($)) }))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const s = await summarize($)
    const [replay, busy] = await Promise.all([read($, hasReplay), read($, isHandingOff)])
    const rest = [
      contextLabel(s.usage),
      ...limitLabels(s.usage, s.now),
      `${shortNumber(totalTokens(s.tokens))} token${costLabel(s.usage)}`,
    ]

    return (
      <Box flexDirection="row">
        <Text wrap="truncate-end">
          {s.cache.state === 'none' ? (
            <Text dimColor>{cacheLabel(s.cache)}</Text>
          ) : (
            <Text color={CACHE_COLOR[s.cache.state]}>{cacheLabel(s.cache)}</Text>
          )}
          <Text dimColor>{` · ${rest.join(' · ')} `}</Text>
        </Text>
        {busy ? (
          <Text dimColor> handoff in corso…</Text>
        ) : (
          <Button
            key="handoff"
            label="Handoff"
            onPress={() => (e.props.isWorking ? $.ui.toast('Aspetta che il turno finisca.') : handoff($))}
          />
        )}
        {replay && (
          <Button key="replay" label="Replay" onPress={() => $.command.run({ command: 'replay' })} />
        )}
      </Box>
    )
  })
}
