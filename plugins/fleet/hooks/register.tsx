import { atom, read, update } from 'claude-code'
import type { AgentStatus, EngineInterface, Register, Timer } from 'claude-code'
import type { Budget, BudgetArgs, FleetAgent } from '../types'

const PANE = 'fleet'
const TOOL = 'set_agent_budget'
const ACTIVE = new Set<AgentStatus>(['pending', 'running', 'waiting', 'idle'])
const FAILED = new Set<AgentStatus>(['failed', 'killed'])

const budget = atom({ plugin: 'fleet', key: 'budget' } as const, {})
const agents = atom({ plugin: 'fleet', key: 'agents' } as const, [])
const doneOffset = atom({ plugin: 'fleet', key: 'doneOffset' } as const, 0)

const MODEL = /(opus|sonnet|haiku|fable)(?:-(\d{1,2})(?!\d)(?:-(\d{1,2})(?!\d))?)?/i

// `claude-opus-5-5` and the alias `opus` are both family `opus`; any other model is its own.
const familyOf = (model: string) => MODEL.exec(model)?.[1]?.toLowerCase() ?? model

// `claude-opus-5-5` (with or without a date suffix) reads `Opus 5.5`, the alias `opus` reads `Opus`.
const labelOf = (model: string) => {
  const [, family, major, minor] = MODEL.exec(model) ?? []
  if (!family) return model

  const name = family.charAt(0).toUpperCase() + family.slice(1).toLowerCase()
  if (!major) return name

  return `${name} ${major}${minor ? `.${minor}` : ''}`
}

// A row keeps the full model id it already knows when the budget names only the alias.
const modelFor = (known: string | undefined, given: string) =>
  known && given.toLowerCase() === familyOf(given) ? known : given

// `new` replaces the caps and restarts the count; `add` raises the caps and keeps it.
const applyBudget = (current: Budget, { mode, caps }: BudgetArgs): Budget => {
  const next: Budget = mode === 'new' ? {} : { ...current }
  for (const [given, n] of Object.entries(caps)) {
    const family = familyOf(given)
    const line = next[family]
    next[family] = { model: modelFor(current[family]?.model, given), cap: (line?.cap ?? 0) + n, spent: line?.spent ?? 0 }
  }

  return next
}

const elapsed = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`

  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

// Agent statuses and elapsed times are not state, so the open pane asks again every second.
let ticker: Timer | undefined
const tick = ($: EngineInterface) => {
  ticker ??= $.clock.every(1000, () => $.ui.invalidate('ui.render'))
}

const DESCRIPTION = [
  'Call this every time the user sets, changes, adds to or clears a subagent budget ("use up to 3 opus and 2 sonnet agents", "add 2 more opus").',
  'It shows the budget in their /fleet pane; it does not enforce it, so you still keep to the budget yourself.',
  'mode "new" replaces the caps and restarts the count; "add" adds to the caps and keeps the count; "new" with empty caps clears the budget.',
].join(' ')

const SCHEMA = {
  type: 'object',
  properties: {
    mode: { type: 'string', enum: ['new', 'add'], description: '"new" for a new budget, "add" to add to the current one' },
    caps: {
      type: 'object',
      description: 'Agents allowed per model, by exact model id: {"claude-opus-5-5": 3, "claude-sonnet-5-5": 2}',
      additionalProperties: { type: 'integer', minimum: 0 },
    },
  },
  required: ['mode', 'caps'],
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'fleet',
      description: 'Toggle the pane with the subagent budget and the agents running now',
      immediate: true,
    })
    await $.tool.register({ name: TOOL, description: DESCRIPTION, inputSchema: SCHEMA, isDeferred: false })
    // A reload keeps the pane open but stops the module's timers.
    if ((await $.ui.panes()).some(pane => pane.id === PANE)) tick($)

    return next(e)
  })

  on('command.run', { command: 'fleet' }, async $ => {
    if ((await $.ui.panes()).some(pane => pane.id === PANE)) {
      await $.ui.close({ id: PANE })
      return {}
    }

    const opened = await $.ui.open({ id: PANE, title: 'Fleet' })
    tick($)
    return opened.isPlaced ? {} : { text: `The fleet pane waits: ${opened.reason}` }
  })

  // Every close, the person's included, stops the redraws.
  on('ui.close', { id: PANE }, ($, e, next) => {
    ticker?.cancel()
    ticker = undefined
    return next(e)
  })

  on('tool.call', { tool: 'mcp__fleet__set_agent_budget' }, async ($, e) => {
    // The schema only guides the model, so the caps are checked again here.
    const mode = e.mode === 'add' ? 'add' : 'new'
    const caps = Object.fromEntries(Object.entries(e.caps ?? {}).filter(([, n]) => Number.isInteger(n) && n >= 0))
    const lines = await update($, budget, current => applyBudget(current, { mode, caps }))

    // A new budget starts the done list again; agents still running stay listed.
    if (mode === 'new') {
      const live = new Set((await $.agent.list()).filter(one => ACTIVE.has(one.status)).map(one => one.id))
      await Promise.all([update($, agents, list => list.filter(one => live.has(one.id))), update($, doneOffset, () => 0)])
    }

    const summary = Object.values(lines)
      .map(line => `${labelOf(line.model)} ${line.spent}/${line.cap ?? '-'}`)
      .join(', ')

    return { result: summary ? `The /fleet pane shows: ${summary}.` : 'Budget cleared.' }
  }).catch(() => ({ deny: 'The fleet pane could not record the budget.' }))

  // Counts every spawn the engine made, nested ones too; never changes or blocks one.
  // Bookkeeping that fails leaves the spawn as the engine answered it.
  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    if (spawned.deny !== undefined) return spawned

    const { model, agentId } = spawned
    const family = familyOf(model)
    const [startedAt] = await Promise.all([
      $.clock.now(),
      update($, budget, current => {
        const line = current[family]
        return { ...current, [family]: { model: modelFor(line?.model, model), cap: line?.cap, spent: (line?.spent ?? 0) + 1 } }
      }),
    ])
    if (agentId) {
      await update($, agents, list => [...list, { id: agentId, model, description: e.description, startedAt }].slice(-200))
    }

    return spawned
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const [lines, spawned, scrolled, listed, now] = await Promise.all([
      read($, budget),
      read($, agents),
      read($, doneOffset),
      $.agent.list(),
      $.clock.now(),
    ])
    // Ended agents leave `$.agent.list()` after a while, so a missing one is done too.
    const status = new Map(listed.map(one => [one.id, one.status]))
    const statusOf = (id: string) => status.get(id) ?? 'completed'
    const active: FleetAgent[] = []
    const finished: FleetAgent[] = []
    for (const one of spawned) (ACTIVE.has(statusOf(one.id)) ? active : finished).push(one)
    finished.reverse()
    const rows = Object.values(lines).filter(line => line.cap !== undefined || line.spent > 0)
    if (rows.length === 0 && spawned.length === 0) return <Text dimColor>No subagents yet.</Text>

    const models = new Set([...rows.map(line => line.model), ...spawned.map(one => one.model)])
    const labelWidth = Math.max(0, ...[...models].map(model => labelOf(model).length))

    // The done list takes the rows left under the budget and the running agents, and scrolls past that.
    const room = Math.max(3, e.props.scroll.bodyRows - rows.length - active.length - 1)
    const isScrolling = finished.length > room
    const size = isScrolling ? room - 2 : finished.length
    const maxOffset = finished.length - size
    const clamp = (n: number) => Math.max(0, Math.min(maxOffset, n))
    const offset = clamp(scrolled)
    const scroll = (by: number) => update($, doneOffset, n => clamp(clamp(n) + by))

    return (
      <Box flexDirection="column">
        {rows.map(line => {
          const tone = line.cap === undefined || line.spent < line.cap ? undefined : line.spent > line.cap ? 'error' : 'warning'
          return (
            <Text key={`budget-${line.model}`} color={tone} wrap="truncate-end">
              {`${labelOf(line.model).padEnd(labelWidth)}  ${line.spent}${line.cap === undefined ? '' : `/${line.cap}`}`}
            </Text>
          )
        })}
        {active.map(one => {
          const isRunning = statusOf(one.id) === 'running'
          return (
            <Box key={`agent-${one.id}`} flexDirection="row">
              <Text color={isRunning ? 'success' : undefined} dimColor={!isRunning}>●</Text>
              <Text>{` ${labelOf(one.model).padEnd(labelWidth)}  `}</Text>
              <Box flexGrow={1}>
                <Text wrap="truncate-end">{one.description}</Text>
              </Box>
              <Box flexShrink={0}>
                <Text>{`  ${elapsed(now - one.startedAt)}`}</Text>
              </Box>
            </Box>
          )
        })}
        {finished.length > 0 && <Text dimColor>done: {finished.length}</Text>}
        {isScrolling && (
          <Button key="done-up" label={`▲ ${offset} more`} hotkey="k" plain dimColor={offset === 0} onPress={() => scroll(-size)} />
        )}
        {finished.slice(offset, offset + size).map(one => {
          const isFailed = FAILED.has(statusOf(one.id))
          return (
            <Text key={`done-${one.id}`} color={isFailed ? 'error' : undefined} dimColor={!isFailed} wrap="truncate-end">
              {`${isFailed ? '✗' : ' '} ${labelOf(one.model).padEnd(labelWidth)}  ${one.description}`}
            </Text>
          )
        })}
        {isScrolling && (
          <Button key="done-down" label={`▼ ${maxOffset - offset} more`} hotkey="j" plain dimColor={offset === maxOffset} onPress={() => scroll(size)} />
        )}
      </Box>
    )
  })
}
