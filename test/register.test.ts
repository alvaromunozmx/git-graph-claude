// The mod as the engine loads it: /git-graph is registered, opens the pane, and the pane
// draws the history git reports. Run by `claude plugin test .` (`npm run test:mod`).
import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { SEP } from '../hooks/graph'

const CWD = '/repo'
const SURFACES = ['terminal', 'desktop'] as const

const LOG = [
  ['b2', 'a1', 'HEAD -> main, origin/main', 'Alvaro', '19 Oct 2026 10:00', 'second commit'],
  ['a1', '', 'tag: v1.0', 'Alvaro', '18 Oct 2026 09:00', 'first commit']
].map(row => row.join(SEP)).join('\n')

/** /git-graph as the person types it at the prompt. */
const typed = (args: string) =>
  ({ command: 'git-graph', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } }) as const

/** The engine beneath the mod: a repo on `main`, and a record of what the mod asked for. */
function world (on: On) {
  const seen = { commands: [] as string[], opened: [] as string[], git: [] as string[][] }
  mock.clock(on, { now: 0 })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: CWD }))
  on('command.register', ($, e) => {
    seen.commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('ui.open', ($, e) => {
    seen.opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('process.run', ($, e) => {
    const [, , cwd, command = '', ...args] = e.argv
    expect(cwd).toBe(CWD)
    seen.git.push([command, ...args])
    const stdout = command === 'remote' ? 'origin\n'
      : command === 'branch' ? 'main\n'
        : command === 'log' ? `${LOG}\n`
          : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return seen
}

test('/git-graph is registered when the session starts', async ($, on) => {
  const seen = world(on)
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  expect(seen.commands).toEqual(['git-graph'])
})

test('/git-graph opens the pane and loads every branch', async ($, on) => {
  const seen = world(on)
  const result = await $.command.run(typed(''))
  expect(result).toEqual({})
  expect(seen.opened).toEqual(['git-graph'])
  expect(seen.git.find(args => args[0] === 'log')).toContain('--all')
})

test('/git-graph current loads only the current branch', async ($, on) => {
  const seen = world(on)
  await $.command.run(typed('current'))
  expect(seen.git.find(args => args[0] === 'log')).not.toContain('--all')
})

test('/git-graph with an unknown argument answers with its usage', async ($, on) => {
  const seen = world(on)
  const result = await $.command.run(typed('nope'))
  expect(result).toEqual({ text: 'Usage: /git-graph [all | current]' })
  expect(seen.opened).toEqual([])
})

test('the pane draws each commit with its refs', async ($, on) => {
  world(on)
  await $.command.run(typed(''))
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({
      plugin: 'git-graph',
      surface,
      component: 'Pane',
      requestId: 'git-graph',
      props: { title: 'Git Graph', isFocused: true, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} }
    })
    expect(await ui.find({ type: 'Text', text: 'second commit' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'first commit' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '[main]' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '◆ v1.0' })).toBeDefined()
    expect(await ui.find({ key: 'hash-b2' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'not a commit' })).toBeUndefined()
  }
})
