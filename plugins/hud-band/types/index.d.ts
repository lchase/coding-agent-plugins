export type Tokens = { inp: number; out: number; cached: number }
export type Hud = { tool: string | null; tools: number }

declare module 'claude-code' {
  interface PluginState {
    'hud-band': { hud: Hud; lastActivity: number; effort: string; tokens: Tokens }
  }
}
