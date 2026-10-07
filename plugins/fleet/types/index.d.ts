// One budget row: a model family's cap and how many agents it spawned since the budget was set.
export type BudgetLine = { model: string; cap?: number; spent: number }

// Keyed by model family (`opus`, `sonnet`, ...).
export type Budget = Record<string, BudgetLine>

// What Claude passes to `set_agent_budget`: caps keyed by model id or alias.
export type BudgetArgs = { mode: 'new' | 'add'; caps: Record<string, number> }

// A spawned subagent; its live status comes from `$.agent.list()` while drawing.
export type FleetAgent = { id: string; model: string; description: string; startedAt: number }

declare module 'claude-code' {
  interface PluginState {
    // `doneOffset`: how many finished agents the done list has scrolled past.
    fleet: { budget: Budget; agents: FleetAgent[]; doneOffset: number }
  }

  interface McpToolInputs {
    mcp__fleet__set_agent_budget: BudgetArgs
  }
}
