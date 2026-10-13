export type Settings = { isOn: boolean; isStrict: boolean }

declare module 'claude-code' {
  interface PluginState {
    // Private words are never kept here, only in $.store.
    'recording-mode': { settings: Settings }
  }
}
