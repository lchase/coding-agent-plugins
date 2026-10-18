export type Last = { reads: number; writes: number; fresh: number; model: string }
export type Totals = { reads: number; writes: number; fresh: number; saved: number; unpricedReads: number }

declare module 'claude-code' {
  interface PluginState {
    'cache-clock': { lastCache: number; toastedFor: number; last: Last | null; totals: Totals; isOn: boolean; nativeAfter: number }
  }
}
