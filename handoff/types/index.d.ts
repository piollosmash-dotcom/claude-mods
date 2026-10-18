export type Fase = 'pronto' | 'riassumo' | 'pulisco'

declare module 'claude-code' {
  interface PluginState {
    handoff: { fase: Fase; percentuale: number | null }
  }
}
