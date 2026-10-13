export type Limit = { kind: string; percentUsed: number; resetsAt?: string }
export type Snapshot = {
  rateLimits: Limit[]
  contextPercent?: number
  costUsd?: number
}
export type Reading = { pct: number; t: number }
export type Settings = { isOn: boolean; warnA: number; warnB: number }

declare module 'claude-code' {
  interface PluginState {
    'usage-gauge': {
      snap: Snapshot | null
      readings: Record<string, Reading[]>
      turns: number[]
      prevCost: number | null
      settings: Settings
    }
  }
}
