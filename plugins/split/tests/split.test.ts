import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

const ran = (stdout: string) => ({
  value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
})

// Stands in for the engine; `titles` are the grep hits from the parent's transcript.
const stub = (on: On, env: Record<string, string>, titles = ['"aiTitle":"Some topic"', '"customTitle":"main-test"']) => {
  const launches: (readonly string[])[] = []
  const store = new Map<string, unknown>()
  on('session.id', () => ({ value: 'abc-123' }))
  on('session.cwd', () => ({ value: "/work/kady's repo" }))
  on('env.get', (_$, e) => ({ value: { HOME: '/home/k', ...env }[e.name] }))
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('process.run', (_$, e) => {
    if (e.argv[0] === 'find') return ran('/home/k/.claude/projects/p/abc-123.jsonl\n')
    if (e.argv[0] === 'grep') return ran(titles.map(line => `${line}\n`).join(''))
    launches.push(e.argv)
    return ran('OK')
  })

  return launches
}

const split = ($: Engine, args: string) =>
  $.command.run({
    command: 'split',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 200 },
  })

const RESUME = `cd '/work/kady'\\''s repo' && claude --resume 'abc-123' --fork-session`

describe('/split', () => {
  test('opens a focused cmux split resuming a named fork of this session', async ($, on) => {
    const launches = stub(on, { CMUX_SURFACE_ID: 'S1', CMUX_BUNDLED_CLI_PATH: '/bin/cmux' })

    const { text } = await split($, '')

    expect(launches).toEqual([
      ['/bin/cmux', 'new-split', 'right', '--command', `${RESUME} --name 'main-test-branch-1'`, '--focus', 'true'],
    ])
    expect(text).toBe('Branched into a right split as main-test-branch-1.')
  })

  test('counts branches per parent name', async ($, on) => {
    const launches = stub(on, { CMUX_SURFACE_ID: 'S1' })

    await split($, '')
    const { text } = await split($, '')

    expect(launches[1]?.[4]).toBe(`${RESUME} --name 'main-test-branch-2'`)
    expect(text).toBe('Branched into a right split as main-test-branch-2.')
  })

  test('falls back to the generated title when the session was never renamed', async ($, on) => {
    const launches = stub(on, { CMUX_SURFACE_ID: 'S1' }, ['"aiTitle":"Old"', '"aiTitle":"It\'s \\"new\\""'])

    await split($, '')

    expect(launches[0]?.[4]).toBe(`${RESUME} --name 'It'\\''s "new"-branch-1'`)
  })

  test('takes a direction and passes the remaining flags to claude', async ($, on) => {
    const launches = stub(on, { CMUX_SURFACE_ID: 'S1' })

    await split($, 'down --model sonnet')

    expect(launches[0]?.[0]).toBe('cmux')
    expect(launches[0]?.[2]).toBe('down')
    expect(launches[0]?.[4]).toBe(`${RESUME} --name 'main-test-branch-1' --model sonnet`)
  })

  test('leaves the name to an explicit -n', async ($, on) => {
    const launches = stub(on, { CMUX_SURFACE_ID: 'S1' })

    const { text } = await split($, '-n my-idea')

    expect(launches[0]?.[4]).toBe(`${RESUME} -n my-idea`)
    expect(text).toBe('Branched into a right split.')
  })

  test('splits a tmux window when not in cmux', async ($, on) => {
    const launches = stub(on, { TMUX: '/tmp/tmux-501/default,1,0' })

    await split($, 'left')

    expect(launches[0]?.slice(0, 6)).toEqual(['tmux', 'split-window', '-h', '-b', '-c', "/work/kady's repo"])
  })

  test('prints the command when there is no multiplexer', async ($, on) => {
    const launches = stub(on, {})

    const { text } = await split($, '')

    expect(launches).toEqual([])
    expect(text).toContain(`${RESUME} --name 'main-test-branch-1'`)
  })
})
