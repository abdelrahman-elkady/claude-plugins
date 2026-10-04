import type { EngineInterface, Register } from 'claude-code'

type Direction = 'right' | 'down' | 'left' | 'up'
type Title = { customTitle?: string; aiTitle?: string }

// Single-quotes a value for the shell the new split runs its command in.
const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`

// `/split [direction] [claude flags]`: the flags pass through to claude verbatim.
const parse = (args: string): { direction: Direction; flags: string } => {
  const trimmed = args.trim()
  const match = /^(right|down|left|up)(?:\s+|$)/.exec(trimmed)
  if (!match) return { direction: 'right', flags: trimmed }

  return { direction: match[1] as Direction, flags: trimmed.slice(match[0].length) }
}

// The session's /rename name, else its generated title, read from its transcript;
// mods have no title API. A fork copies these records, so -n must override them.
const nameOf = async ($: EngineInterface, id: string) => {
  const config = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${await $.env.get('HOME')}/.claude`
  const found = await $.process.run(['find', `${config}/projects`, '-maxdepth', '2', '-name', `${id}.jsonl`])
  const transcript = found.stdout.split('\n').find(Boolean)
  if (!transcript) return id.slice(0, 8)

  const pattern = String.raw`"(customTitle|aiTitle)":"([^"\\]|\\.)*"`
  const grep = await $.process.run(['grep', '-o', '-E', pattern, transcript])
  const titles = grep.stdout
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(`{${line}}`) as Title)

  return (
    titles.findLast(title => title.customTitle)?.customTitle ??
    titles.findLast(title => title.aiTitle)?.aiTitle ??
    id.slice(0, 8)
  )
}

// `<name>-branch-<n>`, counted per parent name across sessions.
const nextBranchName = async ($: EngineInterface, id: string) => {
  const parent = await nameOf($, id)
  const key = `branches:${parent}`
  const n = Number((await $.store.get(key)) ?? 0) + 1
  await $.store.set(key, n)

  return `${parent}-branch-${n}`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'split',
      description: 'Fork this session into a split beside it, named <name>-branch-<n>',
      argumentHint: '[right|down|left|up] [claude flags]',
      immediate: true,
    })

    return next(e)
  })

  on('command.run', { command: 'split' }, async ($, e) => {
    const { direction, flags } = parse(e.args)
    const [id, cwd] = await Promise.all([$.session.id(), $.session.cwd()])
    const hasName = /(?:^|\s)(?:-n|--name)(?:[\s=]|$)/.test(flags)
    const name = hasName ? undefined : await nextBranchName($, id)
    const claude = ['claude', '--resume', quote(id), '--fork-session', name && `--name ${quote(name)}`, flags]
      .filter(Boolean)
      .join(' ')
    const shell = `cd ${quote(cwd)} && ${claude}`
    const done = { text: `Branched into a ${direction} split${name ? ` as ${name}` : ''}.` }

    // cmux splits the surface named by CMUX_SURFACE_ID, the one this session runs in.
    if (await $.env.get('CMUX_SURFACE_ID')) {
      const cmux = (await $.env.get('CMUX_BUNDLED_CLI_PATH')) ?? 'cmux'
      const run = await $.process.run([cmux, 'new-split', direction, '--command', shell, '--focus', 'true'])
      if (run.exitCode === 0) return done

      return { text: `cmux new-split failed: ${(run.stderr || run.stdout).trim()}\nRun it yourself: ${shell}` }
    }

    if (await $.env.get('TMUX')) {
      const axis = direction === 'right' || direction === 'left' ? '-h' : '-v'
      const before = direction === 'left' || direction === 'up' ? ['-b'] : []
      const run = await $.process.run(['tmux', 'split-window', axis, ...before, '-c', cwd, shell])
      if (run.exitCode === 0) return done

      return { text: `tmux split-window failed: ${(run.stderr || run.stdout).trim()}\nRun it yourself: ${shell}` }
    }

    return { text: `Not in cmux or tmux. Run this in a new terminal:\n${shell}` }
  })
}
