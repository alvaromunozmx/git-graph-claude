// The mod as the engine loads it: /git-graph is registered, opens the pane, and the pane
// draws the history git reports. Run by `claude plugin test .` (`npm run test:mod`).
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { SEP } from '../hooks/graph'

const CWD = '/repo'
const SURFACES = ['terminal', 'desktop'] as const

const LOG = [
  ['b2', 'a1', 'HEAD -> main, origin/main', 'Alvaro', '19 Oct 2026 10:00', 'second commit'],
  ['a1', '', 'tag: v1.0', 'Alvaro', '18 Oct 2026 09:00', 'first commit']
].map(row => row.join(SEP)).join('\n')

/** What the fake repo answers, by git subcommand: stdout, or a failure. */
type Answer = string | { exitCode: number; stdout?: string; stderr?: string }
type Repo = Record<string, Answer | ((args: string[]) => Answer)>

const REPO: Repo = {
  remote: 'origin\n',
  'for-each-ref': 'refs/heads/main\nrefs/heads/feature\nrefs/remotes/origin/HEAD\nrefs/remotes/origin/main\n',
  branch: 'main\n',
  'rev-parse': 'b2\n',
  status: '',
  log: `${LOG}\n`,
  show: 'Alvaro <a@b.c> · 19 Oct 2026 10:00\nsecond commit\n\nThe body.\n',
  'diff-tree': 'M\thooks/register.tsx\nA\tREADME.md\n',
  diff: 'diff --git a/README.md b/README.md\nindex 1..2 100644\n--- a/README.md\n+++ b/README.md\n@@ -1 +1,2 @@\n line\n+added line\n'
}

/** /git-graph as the person types it at the prompt. */
const typed = (args: string) =>
  ({ command: 'git-graph', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } }) as const

/** The engine beneath the mod: a repo on `main`, and a record of what the mod asked for. */
function world (on: On, repo: Repo = {}) {
  const answers: Repo = { ...REPO, ...repo }
  const seen = { commands: [] as string[], opened: [] as string[], git: [] as string[][], prompts: [] as string[] }
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
  on('prompt.submit', ($, e) => {
    seen.prompts.push(e.text)
    return { text: e.text }
  })
  on('process.run', ($, e) => {
    const [, , cwd, command = '', ...args] = e.argv
    expect(cwd).toBe(CWD)
    seen.git.push([command, ...args])
    const found = answers[command] ?? ''
    const answer = typeof found === 'function' ? found(args) : found
    const result = typeof answer === 'string' ? { exitCode: 0, stdout: answer, stderr: '' } : { stdout: '', stderr: '', ...answer }
    return { value: { ...result, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return seen
}

const PANE_PROPS = { title: 'Git Graph', isFocused: true, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as const

/** The pane as a surface draws it. */
function mount ($: Engine, surface: (typeof SURFACES)[number]) {
  return $.ui.mount({ plugin: 'git-graph', surface, component: 'Pane', requestId: 'git-graph', props: PANE_PROPS })
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
    const ui = await mount($, surface)
    expect(await ui.find({ type: 'Text', text: 'second commit' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'first commit' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '[main]' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '◆ v1.0' })).toBeDefined()
    expect(await ui.find({ key: 'hash-b2' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'not a commit' })).toBeUndefined()
  }
})

test('a commit opens with its message and the files it changed', async ($, on) => {
  const seen = world(on)
  await $.command.run(typed(''))
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    await ui.press({ key: 'hash-b2' })
    expect(await ui.find({ type: 'Text', text: 'The body.' })).toBeDefined()
    expect(await ui.find({ key: 'file-hooks/register.tsx' })).toBeDefined()
    expect(await ui.find({ key: 'file-README.md' })).toBeDefined()
    // b2's files are read against its first parent
    expect(seen.git.find(args => args[0] === 'diff-tree')).toEqual(['diff-tree', '-r', '-M', '--name-status', '--no-commit-id', 'a1', 'b2'])
    await ui.press({ key: 'hash-b2' })
    expect(await ui.find({ type: 'Text', text: 'The body.' })).toBeUndefined()
  }
})

test('uncommitted changes get a row above HEAD that lists them', async ($, on) => {
  const seen = world(on, { status: ' M hooks/graph.ts\n?? notes.md\n' })
  await $.command.run(typed(''))
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    expect(await ui.find({ type: 'Text', text: 'Uncommitted Changes (2)' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '● 2 uncommitted' })).toBeDefined()
    await ui.press({ key: 'hash-worktree' })
    expect(await ui.find({ type: 'Text', text: '2 files changed in the working tree' })).toBeDefined()
    expect(await ui.find({ key: 'file-hooks/graph.ts' })).toBeDefined()
    expect(await ui.find({ key: 'file-notes.md' })).toBeDefined()
    await ui.press({ key: 'commit' })
    expect(seen.prompts.at(-1)).toContain('Commit the current uncommitted changes')
    await ui.press({ key: 'hash-worktree' })
  }
})

test('a clean tree has no uncommitted row', async ($, on) => {
  world(on)
  await $.command.run(typed(''))
  const ui = await mount($, 'desktop')
  expect(await ui.find({ key: 'hash-worktree' })).toBeUndefined()
})

test('a file opens its diff under it, and closes it again', async ($, on) => {
  const seen = world(on)
  await $.command.run(typed(''))
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    await ui.press({ key: 'hash-b2' })
    await ui.press({ key: 'file-README.md' })
    const code = await ui.find({ type: 'Code' })
    expect(code?.props).toMatchObject({ format: 'diff', path: 'README.md', source: '@@ -1 +1,2 @@\n line\n+added line' })
    expect(seen.git.findLast(args => args[0] === 'diff')).toEqual(['diff', '-M', 'a1', 'b2', '--', 'README.md'])
    await ui.press({ key: 'file-README.md' })
    expect(await ui.find({ type: 'Code' })).toBeUndefined()
    await ui.press({ key: 'hash-b2' })
  }
})

test('an untracked file diffs against nothing', async ($, on) => {
  const seen = world(on, {
    status: '?? notes.md\n',
    diff: { exitCode: 1, stdout: 'diff --git a/notes.md b/notes.md\nnew file mode 100644\n--- /dev/null\n+++ b/notes.md\n@@ -0,0 +1 @@\n+hello\n' }
  })
  await $.command.run(typed(''))
  const ui = await mount($, 'desktop')
  await ui.press({ key: 'hash-worktree' })
  await ui.press({ key: 'file-notes.md' })
  expect((await ui.find({ type: 'Code' }))?.props).toMatchObject({ source: '@@ -0,0 +1 @@\n+hello' })
  expect(seen.git.findLast(args => args[0] === 'diff')).toEqual(['diff', '--no-index', '--', '/dev/null', 'notes.md'])
})

test('the find field keeps the commits that match, lit', async ($, on) => {
  world(on)
  await $.command.run(typed(''))
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    await ui.input({ key: 'find', text: 'FIRST', kind: 'change' })
    expect(await ui.find({ type: 'Text', text: 'first' })).toBeDefined()
    expect(await ui.find({ key: 'hash-a1' })).toBeDefined()
    expect(await ui.find({ key: 'hash-b2' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: '1 match' })).toBeDefined()
    // A hash prefix and a ref name match too
    await ui.input({ key: 'find', text: 'b2' })
    expect(await ui.find({ key: 'hash-b2' })).toBeDefined()
    await ui.input({ key: 'find', text: 'v1.0' })
    expect(await ui.find({ key: 'hash-a1' })).toBeDefined()
    await ui.input({ key: 'find', text: 'nothing like it' })
    expect(await ui.find({ type: 'Text', text: /No commit in the last 2 matches/ })).toBeDefined()
    await ui.press({ key: 'find-clear' })
    expect(await ui.find({ key: 'hash-a1' })).toBeDefined()
    expect(await ui.find({ key: 'hash-b2' })).toBeDefined()
  }
})

test('the branch picker draws one branch alone, or all of them again', async ($, on) => {
  const seen = world(on)
  await $.command.run(typed(''))
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    const picker = await ui.find({ key: 'branches' })
    expect(picker?.props.value).toBe('all')
    expect((picker?.props.options as { value: string }[]).map(option => option.value)).toEqual(['all', 'current', 'ref:main', 'ref:feature', 'ref:origin/main'])
    await ui.select({ key: 'branches', value: 'ref:feature' })
    expect(seen.git.findLast(args => args[0] === 'log')?.[1]).toBe('feature')
    expect((await ui.find({ key: 'branches' }))?.props.value).toBe('ref:feature')
    await ui.select({ key: 'branches', value: 'current' })
    expect(seen.git.findLast(args => args[0] === 'log')).not.toContain('--all')
    await ui.select({ key: 'branches', value: 'all' })
    expect(seen.git.findLast(args => args[0] === 'log')).toContain('--all')
  }
})

test('a picked branch that is gone falls back to every branch', async ($, on) => {
  let refs = 'refs/heads/main\nrefs/heads/feature\n'
  const seen = world(on, { 'for-each-ref': () => refs })
  await $.command.run(typed(''))
  const ui = await mount($, 'desktop')
  await ui.select({ key: 'branches', value: 'ref:feature' })
  refs = 'refs/heads/main\n'
  await ui.press({ key: 'reload' })
  expect(seen.git.findLast(args => args[0] === 'log')).toContain('--all')
  expect((await ui.find({ key: 'branches' }))?.props.value).toBe('all')
})

/** The pane, with the commit `hash` open. */
async function open ($: Engine, surface: (typeof SURFACES)[number], hash: string) {
  const ui = await mount($, surface)
  await ui.press({ key: `hash-${hash}` })
  return ui
}

test('revert, merge and rebase ask for a second click, then run', async ($, on) => {
  const seen = world(on)
  await $.command.run(typed(''))
  const ui = await open($, 'desktop', 'a1')
  await ui.press({ key: 'merge' })
  expect((await ui.find({ key: 'merge' }))?.props.label).toBe('confirm: merge a1 into main?')
  expect(seen.git.some(args => args[0] === 'merge')).toBe(false)
  await ui.press({ key: 'merge' })
  expect(seen.git.findLast(args => args[0] === 'merge')).toEqual(['merge', '--no-edit', 'a1'])

  // The commit stays open after an action
  await ui.press({ key: 'revert' })
  await ui.press({ key: 'revert' })
  expect(seen.git.findLast(args => args[0] === 'revert')).toEqual(['revert', '--no-edit', 'a1'])

  await ui.press({ key: 'rebase' })
  await ui.press({ key: 'rebase' })
  expect(seen.git.findLast(args => args[0] === 'rebase')).toEqual(['rebase', 'a1'])
})

test('a conflict is undone and reported', async ($, on) => {
  const seen = world(on, { merge: args => (args[0] === '--abort' ? '' : { exitCode: 1, stdout: 'CONFLICT (content): Merge conflict in a.ts' }) })
  await $.command.run(typed(''))
  const ui = await open($, 'terminal', 'a1')
  await ui.press({ key: 'merge' })
  await ui.press({ key: 'merge' })
  expect(seen.git.findLast(args => args[0] === 'merge')).toEqual(['merge', '--abort'])
  expect(await ui.find({ type: 'Text', text: /merge stopped on a conflict and was undone/ })).toBeDefined()
})

test('reset offers soft, mixed and hard; hard wants a clean tree', async ($, on) => {
  const seen = world(on, { status: ' M a.ts\n' })
  await $.command.run(typed(''))
  const ui = await open($, 'desktop', 'a1')
  await ui.press({ key: 'reset' })
  await ui.press({ key: 'reset-hard' })
  expect(seen.git.some(args => args[0] === 'reset')).toBe(false)
  expect(await ui.find({ type: 'Text', text: /uncommitted changes: commit or stash/ })).toBeDefined()
  await ui.press({ key: 'reset' })
  await ui.press({ key: 'reset-soft' })
  expect(seen.git.findLast(args => args[0] === 'reset')).toEqual(['reset', '--soft', 'a1'])
})

test('a tag is named in a field: lightweight, or annotated after a colon', async ($, on) => {
  const seen = world(on)
  await $.command.run(typed(''))
  for (const surface of SURFACES) {
    const ui = await open($, surface, 'b2')
    await ui.press({ key: 'tag' })
    await ui.input({ key: 'tag-name', text: 'v2.0' })
    expect(seen.git.findLast(args => args[0] === 'tag')).toEqual(['tag', 'v2.0', 'b2'])
    await ui.press({ key: 'hash-b2' })
    await ui.press({ key: 'hash-b2' })
    await ui.press({ key: 'tag' })
    await ui.input({ key: 'tag-name', text: 'v2.1: the release' })
    expect(seen.git.findLast(args => args[0] === 'tag')).toEqual(['tag', '-a', 'v2.1', '-m', 'the release', 'b2'])
    await ui.press({ key: 'hash-b2' })
  }
})
