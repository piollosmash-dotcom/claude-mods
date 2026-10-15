export type Tokens = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

declare module 'claude-code' {
  interface PluginState {
    'barra-sessione': {
      lastRequestAt: number | null
      tokens: Tokens
      hasReplay: boolean
      isHandingOff: boolean
    }
  }
}
