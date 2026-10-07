import { describe, expect, mock, test } from 'claude-code/testing'
import type { AgentStatus, On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

// Stands in for the engine: spawns get ids a1, a2, ... and `statuses` is what `$.agent.list()` reports.
const stub = (on: On) => {
  const clock = mock.clock(on)
  const statuses = new Map<string, AgentStatus>()
  on('agent.spawn', (_$, e) => {
    const agentId = `a${statuses.size + 1}`
    statuses.set(agentId, 'running')
    return { model: `claude-${e.model ?? 'opus'}-5-5`, agentId }
  })
  on('agent.list', () => ({
    value: [...statuses].map(([id, status]) => ({ id, status, description: '', type: 'general-purpose' })),
  }))

  return { statuses, clock }
}

const tips = (...ns: number[]) => ns.map(n => `Haiku 5.5  tip ${n}`)

const spawn = ($: Engine, description: string, model?: string) =>
  $.agent.spawn({
    tool_use_id: `t-${description}`,
    prompt: 'go',
    description,
    subagentType: 'general-purpose',
    provider: { plugin: 'engine', tier: 'core' },
    model,
    parentModel: 'claude-opus-5-5',
    background: true,
    fork: false,
  })

const setBudget = ($: Engine, mode: 'new' | 'add', caps: Record<string, number>) =>
  $.tool.call({ tool: 'mcp__fleet__set_agent_budget', mode, caps })

const pane = (bodyRows = 20) =>
  ({
    component: 'Pane',
    requestId: 'fleet',
    props: {
      title: 'Fleet',
      isFocused: false,
      bodyColumns: 40,
      placement: 'dock',
      scroll: { offset: 0, bodyRows },
      view: {},
    },
  }) as const

const textsOf = async (ui: { findAll: (query: { type: string }) => Promise<{ text: string }[]> }) =>
  (await ui.findAll({ type: 'Text' })).map(found => found.text)

const drawn = async ($: Engine, key?: string) => {
  const ui = await $.ui.mount({ plugin: 'fleet', surface: 'terminal', ...pane() })
  const texts = key ? [(await ui.find({ key }))?.text ?? ''] : await textsOf(ui)
  await ui.unmount()

  return texts
}

describe('fleet pane', () => {
  test('counts spawns per exact model when there is no budget', async ($, on) => {
    stub(on)

    await spawn($, 'verify invoice guard')
    await spawn($, 'check mirror DB', 'opus')
    await spawn($, 'port helpers', 'sonnet')

    const texts = await drawn($)
    expect(texts).toContain('Opus 5.5    2')
    expect(texts).toContain('Sonnet 5.5  1')
  })

  test('a new budget restarts the count and add keeps it', async ($, on) => {
    stub(on)
    await spawn($, 'before the budget')

    const set = await setBudget($, 'new', { 'claude-opus-5-5': 3, 'claude-sonnet-5-5': 2 })
    expect(set.result).toBe('The /fleet pane shows: Opus 5.5 0/3, Sonnet 5.5 0/2.')

    await spawn($, 'after the budget')
    const added = await setBudget($, 'add', { opus: 2 })
    expect(added.result).toBe('The /fleet pane shows: Opus 5.5 1/5, Sonnet 5.5 0/2.')

    expect(await drawn($)).toContain('Opus 5.5    1/5')
  })

  test('lists running agents with elapsed time and only counts finished ones', async ($, on) => {
    const { statuses, clock } = stub(on)

    await spawn($, 'verify invoice guard')
    await spawn($, 'check mirror DB')
    await spawn($, 'port helpers', 'sonnet')
    statuses.set('a1', 'completed')
    statuses.delete('a2')
    await clock.advance(125_000)

    expect(await drawn($, 'agent-a3')).toEqual(['● Sonnet 5.5  port helpers  2m'])
    const texts = await drawn($)
    expect(texts).toContain('done: 2')
    expect(texts.slice(-2)).toEqual(['  Opus 5.5    check mirror DB', '  Opus 5.5    verify invoice guard'])
  })

  test('marks failed and killed agents in the done list', async ($, on) => {
    const { statuses } = stub(on)

    await spawn($, 'flaky job')
    statuses.set('a1', 'failed')

    expect(await drawn($)).toContain('✗ Opus 5.5  flaky job')
  })

  test('scrolls the done list a page at a time when it does not fit', async ($, on) => {
    const { statuses } = stub(on)
    for (const n of [1, 2, 3, 4, 5, 6, 7]) await spawn($, `tip ${n}`, 'haiku')
    for (const id of statuses.keys()) statuses.set(id, 'completed')

    // 8 rows: the budget row and `done: 7` leave 6, two of them the scroll buttons.
    const ui = await $.ui.mount({ plugin: 'fleet', surface: 'terminal', ...pane(8) })
    const done = async () => (await textsOf(ui)).filter(text => text.includes('tip')).map(text => text.trim())
    const firstPage = tips(7, 6, 5, 4)

    expect(await done()).toEqual(firstPage)
    expect((await ui.find({ key: 'done-down' }))?.props.label).toBe('▼ 3 more')

    await ui.press({ key: 'done-down' })
    expect(await done()).toEqual(tips(4, 3, 2, 1))
    expect((await ui.find({ key: 'done-up' }))?.props.label).toBe('▲ 3 more')

    await ui.press({ key: 'done-up' })
    expect(await done()).toEqual(firstPage)
    await ui.unmount()
  })

  test('shows a hint before any agent ran', async ($, on) => {
    stub(on)
    expect(await drawn($)).toEqual(['No subagents yet.'])
  })
})

describe('/fleet', () => {
  test('opens the pane, and closes it when run again', async ($, on) => {
    mock.clock(on)
    const open = new Set<string>()
    on('ui.panes', () => ({
      value: [...open].map(id => ({ id, title: 'Fleet', isShown: true, isFocused: false, isPlaced: true })),
    }))
    on('ui.open', (_$, e) => {
      open.add(e.id)
      return { value: { isPlaced: true } }
    })
    on('ui.close', (_$, e) => {
      open.delete(e.id)
      return { value: undefined }
    })
    const fleet = () =>
      $.command.run({
        command: 'fleet',
        args: '',
        origin: { kind: 'composer' },
        presentation: { isFullscreen: true, columns: 200 },
      })

    await fleet()
    expect([...open]).toEqual(['fleet'])

    await fleet()
    expect([...open]).toEqual([])
  })
})
