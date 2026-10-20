export type Phase = 'idle' | 'ask' | 'saving' | 'saved'

export type Band = {
  percent: number | null
  phase: Phase
  savedAt: number | null
  seen: number
  from: { at: number; objective: string } | null
  model: string | null
  effort: string | number | null
}

declare module 'claude-code' {
  interface PluginState {
    'auto-handoff': { band: Band }
  }
}
