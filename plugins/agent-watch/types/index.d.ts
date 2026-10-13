export type Status = 'running' | 'done' | 'failed'

export type AgentRow = {
  id: string
  /** Agent type or given name; `main` for the chat itself. */
  type: string
  task: string
  /** Model label already shortened, e.g. `opus·5.5`; empty until known. */
  model: string
  status: Status
  /** `main` or the id of the agent that spawned this one. */
  parent: string
  calls: number
  tokensIn: number
  tokensOut: number
  skills: string[]
  startedAt: number
  endedAt?: number
}

export type Run = {
  startedAt: number
  endedAt?: number
  /** Spawn order; `main` first. */
  order: string[]
  agents: Record<string, AgentRow>
  /** Every skill that ran this turn, once each. */
  skills: string[]
  /** Skill tool calls waiting for their skill.prompt, to attribute it. */
  pending: { skill: string; agentId: string }[]
  byModel: Record<string, { steps: number; calls: number; tokensIn: number; tokensOut: number }>
}

export type Settings = { isOn: boolean }

declare module 'claude-code' {
  interface PluginState {
    'agent-watch': { run: Run | null; settings: Settings }
  }
}
