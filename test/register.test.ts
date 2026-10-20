// The mod as the engine loads it: /git-graph is registered, opens the pane, and the pane
// draws the history git reports. Run by `claude plugin test .` (`npm run test:mod`).
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { SEP } from '../hooks/graph'

const CWD = '/repo'
const SURFACES = ['terminal', 'desktop'] as const

const LOG = [
  ['c3', 'a1', 'feature, origin/feature', 'Ana', '19 Oct 2026 11:00', 'feature work'],
  ['b2', 'a1', 'HEAD -> main, origin/main', 'Alvaro', '19 Oct 2026 10:00', 'second commit'],
  ['a1', '', 'tag: v1.0', 'Alvaro', '18 Oct 2026 09:00', 'first commit']
].map(row => row.join(SEP)).join('\n')

/** What the fake repo answers, by git subcommand: stdout, or a failure. */
type Answer = string | { exitCode: number; stdout?: string; stderr?: string }
type Repo = Record<string, Answer | ((args: string[]) => Answer)>

const REPO: Repo = {
  remote: 'origin\n',
  // Branches, or (asked with an upstream format) each local branch's upstream and track
  'for-each-ref': args => (args[0]?.includes('upstream')
    ? 'main\torigin/main\t\nfeature\torigin/feature\t[ahead 1, behind 2]\n'
    : 'refs/heads/main\nrefs/heads/feature\nrefs/remotes/origin/HEAD\nrefs/remotes/origin/main\n'),
  branch: 'main\n',
  'rev-parse': args => (args[0] === '--show-toplevel' ? `${CWD}\n` : 'b2\n'),
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
  const seen = { commands: [] as string[], opened: [] as string[], git: [] as string[][], prompts: [] as string[], cwds: [] as string[], toasts: [] as string[] }
  mock.clock(on, { now: 0 })
  on('ui.toast', ($, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
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
    const [, , cwd = '', command = '', ...args] = e.argv
    // Every git call runs in the repo, or in one of its submodules
    expect(cwd.startsWith(CWD)).toBe(true)
    seen.cwds.push(cwd)
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
    expect((await ui.find({ type: 'Markdown' }))?.props.text).toBe('second commit\n\nThe body.')
    expect(await ui.find({ key: 'file-hooks/register.tsx' })).toBeDefined()
    expect(await ui.find({ key: 'file-README.md' })).toBeDefined()
    // b2's files are read against its first parent
    expect(seen.git.find(args => args[0] === 'diff-tree')).toEqual(['diff-tree', '-r', '-M', '--name-status', '--no-commit-id', 'a1', 'b2'])
    await ui.press({ key: 'hash-b2' })
    expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
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
    expect(await ui.find({ type: 'Text', text: /No commit in the last 3 matches/ })).toBeDefined()
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
    expect((picker?.props.options as { value: string; label?: string }[]).map(option => option.label)).toEqual(['all branches', 'current branch', '── local ──', 'main', 'feature', '── remote ──', 'origin/main'])
    // A separator picks nothing
    await ui.select({ key: 'branches', value: 'sep:remote' })
    expect((await ui.find({ key: 'branches' }))?.props.value).toBe('all')
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

test('a branch badge opens its actions under the row', async ($, on) => {
  const seen = world(on)
  await $.command.run(typed(''))
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    await ui.press({ key: 'ref-local-feature' })
    expect(await ui.find({ type: 'Text', text: 'Branch feature' })).toBeDefined()
    expect(await ui.find({ key: 'rebase-ref' })).toBeDefined()
    await ui.press({ key: 'merge-ref' })
    await ui.press({ key: 'merge-ref' })
    expect(seen.git.findLast(args => args[0] === 'merge')).toEqual(['merge', '--no-edit', 'feature'])
    await ui.press({ key: 'push-ref' })
    await ui.press({ key: 'push-ref' })
    expect(seen.git.findLast(args => args[0] === 'push')).toEqual(['push', '-u', 'origin', 'feature'])
    await ui.press({ key: 'rename' })
    await ui.input({ key: 'rename-branch', text: 'feature-2' })
    expect(seen.git.findLast(args => args[0] === 'branch' && args[1] !== '--show-current')).toEqual(['branch', '-m', 'feature', 'feature-2'])
  }
})

test('the current branch pulls, and offers no checkout', async ($, on) => {
  const seen = world(on)
  await $.command.run(typed(''))
  const ui = await mount($, 'desktop')
  await ui.press({ key: 'ref-head-main' })
  expect(await ui.find({ type: 'Text', text: 'Current branch main' })).toBeDefined()
  expect(await ui.find({ key: 'checkout-ref' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'in step with origin/main' })).toBeDefined()
  await ui.press({ key: 'pull' })
  expect(seen.git.findLast(args => args[0] === 'pull')).toEqual(['pull', '--ff-only'])
})

test('an unmerged branch asks again before it is forced', async ($, on) => {
  const seen = world(on, { branch: args => (args[0] === '-d' ? { exitCode: 1, stderr: "error: the branch 'feature' is not fully merged." } : 'main\n') })
  await $.command.run(typed(''))
  const ui = await mount($, 'terminal')
  await ui.press({ key: 'ref-local-feature' })
  await ui.press({ key: 'delete-branch' })
  await ui.press({ key: 'delete-branch' })
  expect(seen.git.findLast(args => args[0] === 'branch' && args[1] !== '--show-current')).toEqual(['branch', '-d', 'feature'])
  expect((await ui.find({ key: 'force-delete-branch' }))?.props.label).toBe('confirm: delete feature and its unmerged commits?')
  await ui.press({ key: 'force-delete-branch' })
  expect(seen.git.findLast(args => args[0] === 'branch' && args[1] !== '--show-current')).toEqual(['branch', '-D', 'feature'])
})

test('a remote branch checks out tracking, fetches and deletes on its remote', async ($, on) => {
  const seen = world(on, { 'for-each-ref': 'refs/heads/main\nrefs/remotes/origin/main\nrefs/remotes/origin/feature\n' })
  await $.command.run(typed(''))
  const ui = await mount($, 'desktop')
  await ui.press({ key: 'ref-remote-origin/feature' })
  await ui.press({ key: 'checkout-ref' })
  await ui.press({ key: 'checkout-ref' })
  expect(seen.git.findLast(args => args[0] === 'switch')).toEqual(['switch', '--track', 'origin/feature'])
  await ui.press({ key: 'fetch-ref' })
  expect(seen.git.findLast(args => args[0] === 'fetch')).toEqual(['fetch', 'origin', 'feature'])
  await ui.press({ key: 'delete-remote-branch' })
  await ui.press({ key: 'delete-remote-branch' })
  expect(seen.git.findLast(args => args[0] === 'push')).toEqual(['push', 'origin', '--delete', 'feature'])
})

test('a tag pushes and deletes', async ($, on) => {
  const seen = world(on)
  await $.command.run(typed(''))
  const ui = await mount($, 'desktop')
  await ui.press({ key: 'ref-tag-v1.0' })
  await ui.press({ key: 'push-ref' })
  await ui.press({ key: 'push-ref' })
  expect(seen.git.findLast(args => args[0] === 'push')).toEqual(['push', 'origin', 'refs/tags/v1.0'])
  await ui.press({ key: 'delete-tag' })
  await ui.press({ key: 'delete-tag' })
  expect(seen.git.findLast(args => args[0] === 'tag')).toEqual(['tag', '-d', 'v1.0'])
})

test('fetch brings every remote, pruned', async ($, on) => {
  const seen = world(on)
  await $.command.run(typed(''))
  const ui = await mount($, 'desktop')
  await ui.press({ key: 'fetch' })
  expect(seen.git.findLast(args => args[0] === 'fetch')).toEqual(['fetch', '--all', '--prune', '--tags'])
  // Done, it is a toast; the line that said it was under way is gone
  expect(seen.toasts.at(-1)).toBe('Git Graph · fetched every remote')
  expect(await ui.find({ type: 'Text', text: /fetch/ })).toBeUndefined()
  // The log is read again after it
  expect(seen.git.at(-1)?.[0]).not.toBe('fetch')
})

test('a repo with no remote has no fetch', async ($, on) => {
  world(on, { remote: '' })
  await $.command.run(typed(''))
  const ui = await mount($, 'terminal')
  expect(await ui.find({ key: 'fetch' })).toBeUndefined()
})

const STASHES = [['s1', 'b2 i1', 'stash@{0}', 'Alvaro', '19 Oct 2026 12:00', 'WIP on main: second commit']].map(row => row.join(SEP)).join('\n')

test('a stash forks off its commit and applies, pops or drops', async ($, on) => {
  const seen = world(on, { stash: args => (args[0] === 'list' ? `${STASHES}\n` : '') })
  await $.command.run(typed(''))
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    expect(await ui.find({ type: 'Text', text: '[stash@{0}] ' })).toBeDefined()
    // The log leaves the stash ref out: the stash list draws it
    expect(seen.git.findLast(args => args[0] === 'log')?.slice(1, 3)).toEqual(['--exclude=refs/stash', '--all'])
    await ui.press({ key: 'hash-s1' })
    // A stash's files are read against the commit it was made on
    expect(seen.git.findLast(args => args[0] === 'diff-tree')?.slice(-2)).toEqual(['b2', 's1'])
    await ui.press({ key: 'stash-apply' })
    expect(seen.git.findLast(args => args[0] === 'stash' && args[1] !== 'list')).toEqual(['stash', 'apply', 'stash@{0}'])
    await ui.press({ key: 'stash-drop' })
    expect((await ui.find({ key: 'stash-drop' }))?.props.label).toBe('confirm: drop stash@{0}?')
    await ui.press({ key: 'stash-drop' })
    expect(seen.git.findLast(args => args[0] === 'stash' && args[1] !== 'list')).toEqual(['stash', 'drop', 'stash@{0}'])
  }
})

test('a branch is made from a stash in a field', async ($, on) => {
  const seen = world(on, { stash: args => (args[0] === 'list' ? `${STASHES}\n` : '') })
  await $.command.run(typed(''))
  const ui = await mount($, 'desktop')
  await ui.press({ key: 'hash-s1' })
  await ui.press({ key: 'stash-branch' })
  await ui.input({ key: 'stash-branch-name', text: 'rescued' })
  expect(seen.git.findLast(args => args[0] === 'stash' && args[1] !== 'list')).toEqual(['stash', 'branch', 'rescued', 'stash@{0}'])
})

test('uncommitted changes stash with a message, untracked files included', async ($, on) => {
  const seen = world(on, { status: ' M a.ts\n' })
  await $.command.run(typed(''))
  const ui = await mount($, 'terminal')
  await ui.press({ key: 'hash-worktree' })
  await ui.press({ key: 'stash' })
  await ui.input({ key: 'stash-message', text: 'half done' })
  expect(seen.git.findLast(args => args[0] === 'stash' && args[1] !== 'list')).toEqual(['stash', 'push', '--include-untracked', '-m', 'half done'])
})

test('two commits compare: the files and diffs from the older to the newer', async ($, on) => {
  const seen = world(on, { diff: args => (args[0] === '--name-status' ? 'M\tREADME.md\nD\told.ts\n' : REPO.diff as string) })
  await $.command.run(typed(''))
  for (const surface of SURFACES) {
    const ui = await open($, surface, 'b2')
    await ui.press({ key: 'compare' })
    expect(await ui.find({ type: 'Text', text: '⇄ comparing with b2' })).toBeDefined()
    await ui.press({ key: 'hash-a1' })
    expect(await ui.find({ type: 'Text', text: '2 files changed from a1 to b2' })).toBeDefined()
    expect(seen.git.findLast(args => args[0] === 'diff' && args[1] === '--name-status')).toEqual(['diff', '--name-status', '-M', 'a1', 'b2'])
    await ui.press({ key: 'file-old.ts' })
    expect(seen.git.findLast(args => args[0] === 'diff')).toEqual(['diff', '-M', 'a1', 'b2', '--', 'old.ts'])
    await ui.press({ key: 'compare-stop' })
    expect(await ui.find({ type: 'Text', text: '⇄ comparing with b2' })).toBeUndefined()
    // The open commit goes back to its own files
    expect(await ui.find({ type: 'Text', text: /changed from/ })).toBeUndefined()
    await ui.press({ key: 'hash-a1' })
  }
})

test('the working tree compares with a commit', async ($, on) => {
  const seen = world(on, { status: ' M a.ts\n', diff: 'M\ta.ts\n' })
  await $.command.run(typed(''))
  const ui = await open($, 'desktop', 'a1')
  await ui.press({ key: 'compare' })
  await ui.press({ key: 'hash-worktree' })
  expect(await ui.find({ type: 'Text', text: '1 file changed from a1 to the working tree' })).toBeDefined()
  expect(seen.git.findLast(args => args[0] === 'diff' && args[1] === '--name-status')).toEqual(['diff', '--name-status', '-M', 'a1'])
})

test('each file shows the lines it added and deleted, and the commit its totals', async ($, on) => {
  world(on, { 'diff-tree': args => (args.includes('--numstat') ? '10\t2\thooks/register.tsx\n-\t-\tlogo.png\n' : 'M\thooks/register.tsx\nA\tlogo.png\n') })
  await $.command.run(typed(''))
  for (const surface of SURFACES) {
    const ui = await open($, surface, 'b2')
    expect(await ui.find({ type: 'Text', text: 'Alvaro <a@b.c> · 19 Oct 2026 10:00  ·  2 files changed, +10 −2' })).toBeDefined()
    const file = await ui.find({ key: 'file-hooks/register.tsx' })
    expect(file?.text).toContain('+10')
    expect(file?.text).toContain('−2')
    expect((await ui.find({ key: 'file-logo.png' }))?.text).toContain('binary')
    await ui.press({ key: 'hash-b2' })
  }
})

test('j and k walk the commits, h goes to HEAD', async ($, on) => {
  world(on)
  await $.command.run(typed(''))
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    expect((await ui.find({ key: 'next' }))?.props.hotkey).toBe('j')
    await ui.press({ key: 'next' })
    expect((await ui.find({ key: 'hash-c3' }))?.props.dimColor).toBe(false)
    await ui.press({ key: 'next' })
    expect((await ui.find({ key: 'hash-b2' }))?.props.dimColor).toBe(false)
    expect((await ui.find({ key: 'hash-c3' }))?.props.dimColor).toBe(true)
    await ui.press({ key: 'next' })
    await ui.press({ key: 'next' })
    // The walk stops at the last commit
    expect((await ui.find({ key: 'hash-a1' }))?.props.dimColor).toBe(false)
    await ui.press({ key: 'previous' })
    expect((await ui.find({ key: 'hash-b2' }))?.props.dimColor).toBe(false)
    await ui.press({ key: 'head' })
    expect((await ui.find({ key: 'hash-b2' }))?.props.dimColor).toBe(false)
    await ui.press({ key: 'hash-b2' })
  }
})

test('the walk follows the find field', async ($, on) => {
  world(on)
  await $.command.run(typed(''))
  const ui = await mount($, 'desktop')
  await ui.input({ key: 'find', text: 'commit' })
  await ui.press({ key: 'next' })
  expect((await ui.find({ key: 'hash-b2' }))?.props.dimColor).toBe(false)
  await ui.press({ key: 'next' })
  expect((await ui.find({ key: 'hash-a1' }))?.props.dimColor).toBe(false)
})

test('the settings dim merges, and commits HEAD does not reach', async ($, on) => {
  const log = [
    ['m4', 'b2 c3', 'HEAD -> main', 'Alvaro', '19 Oct 2026 13:00', 'merge feature'],
    ['d5', 'a1', 'other', 'Ana', '19 Oct 2026 12:00', 'elsewhere'],
    ['c3', 'a1', 'feature', 'Ana', '19 Oct 2026 11:00', 'feature work'],
    ['b2', 'a1', '', 'Alvaro', '19 Oct 2026 10:00', 'second commit'],
    ['a1', '', '', 'Alvaro', '18 Oct 2026 09:00', 'first commit']
  ].map(row => row.join(SEP)).join('\n')
  world(on, { log, 'rev-parse': args => (args[0] === '--show-toplevel' ? `${CWD}\n` : 'm4\n') })
  await $.command.run(typed(''))
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    // The innermost Text holding the subject is the one styled
    const dim = async (subject: string) => (await ui.findAll({ type: 'Text', text: subject })).at(-1)?.props.dimColor
    // Merges are dim by default, like Git Graph
    expect(await dim('merge feature')).toBe(true)
    expect(await dim('elsewhere')).toBe(false)
    await ui.press({ key: 'settings' })
    await ui.press({ key: 'mute-merges' })
    expect(await dim('merge feature')).toBe(false)
    await ui.press({ key: 'mute-others' })
    expect(await dim('elsewhere')).toBe(true)
    expect(await dim('feature work')).toBe(false)
    await ui.press({ key: 'mute-others' })
    await ui.press({ key: 'mute-merges' })
    await ui.press({ key: 'settings' })
  }
})

test('compact lives in the settings panel', async ($, on) => {
  world(on)
  await $.command.run(typed(''))
  const ui = await mount($, 'desktop')
  expect(await ui.find({ key: 'compact' })).toBeUndefined()
  await ui.press({ key: 'settings' })
  await ui.press({ key: 'compact' })
  expect((await ui.find({ key: 'compact' }))?.props.label).toBe('compact')
})

test('a message links its issues, and the commit its page, on GitHub', async ($, on) => {
  world(on, {
    remote: args => (args[0] === 'get-url' ? 'git@github.com:alvaromunozmx/git-graph-claude.git\n' : 'origin\n'),
    show: 'Alvaro <a@b.c> · today\nFix the pane (#12)\n\nSee https://example.com/a.\n'
  })
  await $.command.run(typed(''))
  for (const surface of SURFACES) {
    const ui = await open($, surface, 'b2')
    expect((await ui.find({ type: 'Markdown' }))?.props.text).toBe(
      'Fix the pane ([#12](https://github.com/alvaromunozmx/git-graph-claude/issues/12))\n\nSee <https://example.com/a>.'
    )
    expect((await ui.find({ type: 'Link' }))?.props).toMatchObject({ href: 'https://github.com/alvaromunozmx/git-graph-claude/commit/b2', label: '↗ github.com' })
    await ui.press({ key: 'hash-b2' })
  }
})

test('desktop draws the lanes as curves, unless the settings say glyphs', async ($, on) => {
  world(on)
  await $.command.run(typed(''))
  const desktop = await mount($, 'desktop')
  // The lanes' SVGs say `graph`; the avatars say their initials
  const lanes = async () => (await desktop.findAll({ type: 'Svg' })).filter(svg => svg.props.alt === 'graph')
  const rows = await lanes()
  expect(rows).toHaveLength(3)
  // Desktop leaves out an SVG with nothing in its alt
  expect(rows.every(row => row.props.alt !== '')).toBe(true)
  expect(String(rows[0]?.props.source)).toContain('<circle')
  await desktop.press({ key: 'settings' })
  await desktop.press({ key: 'curves' })
  expect((await desktop.find({ key: 'curves' }))?.props.label).toBe('glyphs')
  expect(await lanes()).toHaveLength(0)
  expect(await desktop.find({ type: 'Text', text: '●' })).toBeDefined()
  await desktop.press({ key: 'curves' })
  // The terminal draws no SVG: it keeps the glyphs and offers no switch
  const terminal = await mount($, 'terminal')
  expect(await terminal.find({ key: 'curves' })).toBeUndefined()
  expect(await terminal.find({ type: 'Text', text: '●' })).toBeDefined()
})

test('mobile draws no field or picker: the branch toggle stands in', async ($, on) => {
  world(on)
  await $.command.run(typed(''))
  const ui = await $.ui.mount({ plugin: 'git-graph', surface: 'mobile', component: 'Pane', requestId: 'git-graph', props: PANE_PROPS })
  expect(await ui.find({ type: 'Text', text: 'second commit' })).toBeDefined()
  expect(await ui.find({ key: 'find' })).toBeUndefined()
  expect((await ui.find({ key: 'branches' }))?.type).toBe('Button')
})

test('each author has an avatar, which the settings can hide', async ($, on) => {
  world(on)
  await $.command.run(typed(''))
  const desktop = await mount($, 'desktop')
  // The avatars are the SVGs that say their initials; the lanes' say `graph`
  expect((await desktop.findAll({ type: 'Svg' })).map(svg => svg.props.alt).filter(alt => alt !== 'graph')).toEqual(['AN', 'AL', 'AL'])
  const terminal = await mount($, 'terminal')
  expect(await terminal.find({ type: 'Text', text: 'AN' })).toBeDefined()
  await terminal.press({ key: 'settings' })
  await terminal.press({ key: 'avatars' })
  expect(await terminal.find({ type: 'Text', text: 'AN' })).toBeUndefined()
})

test('a repo with submodules gets a repo picker that draws each one', async ($, on) => {
  const seen = world(on, { submodule: ' 1a2b lib/core (heads/main)\n-3c4d lib/unused\n' })
  await $.command.run(typed(''))
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    const picker = await ui.find({ key: 'repo' })
    expect((picker?.props.options as { value: string; label: string }[])).toEqual([{ value: CWD, label: 'repo' }, { value: `${CWD}/lib/core`, label: 'lib/core' }])
    await ui.select({ key: 'repo', value: `${CWD}/lib/core` })
    expect(seen.cwds.at(-1)).toBe(`${CWD}/lib/core`)
    expect((await ui.find({ key: 'repo' }))?.props.value).toBe(`${CWD}/lib/core`)
    await ui.select({ key: 'repo', value: CWD })
    expect(seen.cwds.at(-1)).toBe(CWD)
  }
})

test('a repo with no submodule has no repo picker', async ($, on) => {
  world(on)
  await $.command.run(typed(''))
  const ui = await mount($, 'desktop')
  expect(await ui.find({ key: 'repo' })).toBeUndefined()
})

test('the settings hide the author or date column and change the date format', async ($, on) => {
  const seen = world(on)
  await $.command.run(typed(''))
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    await ui.press({ key: 'settings' })
    expect(await ui.find({ type: 'Text', text: '19 Oct 2026 10:00' })).toBeDefined()
    await ui.press({ key: 'show-date' })
    expect(await ui.find({ type: 'Text', text: '19 Oct 2026 10:00' })).toBeUndefined()
    await ui.press({ key: 'show-date' })
    await ui.press({ key: 'show-author' })
    expect(await ui.find({ type: 'Text', text: 'Ana' })).toBeUndefined()
    await ui.press({ key: 'show-author' })
    await ui.press({ key: 'date-format' })
    expect(seen.git.findLast(args => args[0] === 'log')).toContain('--date=relative')
    await ui.press({ key: 'date-format' })
    expect(seen.git.findLast(args => args[0] === 'log')).toContain('--date=format:%Y-%m-%d %H:%M')
    await ui.press({ key: 'date-format' })
    expect((await ui.find({ key: 'date-format' }))?.props.label).toBe('date: absolute')
    await ui.press({ key: 'settings' })
  }
})

test('the settings are kept for the next session', async ($, on) => {
  // The plugin's store, as the last session left it
  const kept: Record<string, unknown> = { settings: { compact: true, showAuthor: false, dateFormat: 'iso', muteMerges: 'yes' } }
  on('store.get', ($, e) => ({ value: kept[e.key] }))
  on('store.set', ($, e) => {
    kept[e.key] = e.value
    return { value: undefined }
  })
  const seen = world(on)
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  await $.command.run(typed(''))
  const ui = await mount($, 'desktop')
  expect(seen.git.findLast(args => args[0] === 'log')).toContain('--date=format:%Y-%m-%d %H:%M')
  expect(await ui.find({ type: 'Text', text: 'Ana' })).toBeUndefined()
  await ui.press({ key: 'settings' })
  expect((await ui.find({ key: 'compact' }))?.props.label).toBe('compact')
  // A value of the wrong kind keeps its default
  expect((await ui.find({ key: 'mute-merges' }))?.props.label).toBe('☑ merge commits')
  await ui.press({ key: 'avatars' })
  expect(kept.settings).toMatchObject({ compact: true, avatars: false, dateFormat: 'iso' })
})

test('a branch links to a pull request into the remote HEAD branch', async ($, on) => {
  world(on, {
    remote: args => (args[0] === 'get-url' ? 'https://github.com/o/r.git\n' : 'origin\n'),
    'symbolic-ref': 'origin/main\n'
  })
  await $.command.run(typed(''))
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    await ui.press({ key: 'ref-remote-origin/feature' })
    expect((await ui.find({ type: 'Link' }))?.props).toMatchObject({ href: 'https://github.com/o/r/compare/main...feature?expand=1', label: '↗ pull request into main' })
    // The default branch itself opens none
    await ui.press({ key: 'ref-head-main' })
    expect(await ui.find({ type: 'Link' })).toBeUndefined()
    await ui.press({ key: 'ref-head-main' })
  }
})

test('a signed commit says who signed it, and whether git trusts it', async ($, on) => {
  world(on, { show: `G${SEP}Alvaro <a@b.c>${SEP}ABC123\nAlvaro <a@b.c> · today\nsigned work\n` })
  await $.command.run(typed(''))
  for (const surface of SURFACES) {
    const ui = await open($, surface, 'b2')
    const line = await ui.find({ type: 'Text', text: '✓ good signature by Alvaro <a@b.c> (key ABC123)' })
    expect(line?.props.color).toBe('green')
    expect((await ui.find({ type: 'Markdown' }))?.props.text).toBe('signed work')
    await ui.press({ key: 'hash-b2' })
  }
})

test('an unsigned commit draws no signature line', async ($, on) => {
  world(on, { show: `N${SEP}${SEP}\nAlvaro <a@b.c> · today\nplain work\n` })
  await $.command.run(typed(''))
  const ui = await open($, 'desktop', 'b2')
  expect(await ui.find({ type: 'Text', text: /signature/ })).toBeUndefined()
  expect((await ui.find({ type: 'Markdown' }))?.props.text).toBe('plain work')
})

test('an open commit keeps the lanes going beside its panel', async ($, on) => {
  world(on)
  await $.command.run(typed(''))
  // b2 sits beside c3's lane; both lanes go on down to a1
  const desktop = await open($, 'desktop', 'b2')
  const beside = (await desktop.findAll({ type: 'Svg' })).filter(svg => String(svg.props.source).includes('V3800'))
  expect(beside).toHaveLength(1)
  expect(String(beside[0]?.props.source).match(/<path /g)).toHaveLength(2)
  await desktop.press({ key: 'hash-b2' })
  const terminal = await open($, 'terminal', 'b2')
  expect(await terminal.findAll({ type: 'Text', text: /^│\n│/ })).toHaveLength(2)
  // The last commit has nothing below it: no lanes beside its panel
  await terminal.press({ key: 'hash-a1' })
  expect(await terminal.findAll({ type: 'Text', text: /^│\n│/ })).toHaveLength(0)
})

test('a local branch not checked out pulls from its upstream without a checkout', async ($, on) => {
  const seen = world(on)
  await $.command.run(typed(''))
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    await ui.press({ key: 'ref-local-feature' })
    expect(await ui.find({ type: 'Text', text: '↑1 to push, ↓2 to pull · origin/feature' })).toBeDefined()
    expect((await ui.find({ key: 'pull' }))?.props.label).toBe('⇣ Pull from origin/feature')
    await ui.press({ key: 'pull' })
    expect(seen.git.findLast(args => args[0] === 'fetch')).toEqual(['fetch', 'origin', 'feature:feature'])
    await ui.press({ key: 'ref-local-feature' })
  }
})

test('a branch with no upstream offers no pull', async ($, on) => {
  world(on, { 'for-each-ref': args => (args[0]?.includes('upstream') ? 'main\torigin/main\t\n' : 'refs/heads/main\nrefs/heads/feature\n') })
  await $.command.run(typed(''))
  const ui = await mount($, 'desktop')
  await ui.press({ key: 'ref-local-feature' })
  expect(await ui.find({ key: 'pull' })).toBeUndefined()
})

test('a commit panel has a title, quick links and its actions in groups', async ($, on) => {
  world(on, { remote: args => (args[0] === 'get-url' ? 'git@github.com:o/r.git\n' : 'origin\n') })
  await $.command.run(typed(''))
  for (const surface of SURFACES) {
    const ui = await open($, surface, 'a1')
    expect(await ui.find({ type: 'Text', text: 'Commit a1' })).toBeDefined()
    expect((await ui.find({ type: 'Link' }))?.props.href).toBe('https://github.com/o/r/commit/a1')
    // Actions are real buttons, not plain links, in two groups split by a bar
    expect((await ui.find({ key: 'checkout' }))?.props.plain).toBeUndefined()
    // (the terminal's lanes are drawn with the same bar, so it is counted on desktop alone)
    if (surface === 'desktop') expect(await ui.findAll({ type: 'Text', text: '│' })).toHaveLength(1)
    // The one waiting for its confirming press is the primary one
    await ui.press({ key: 'revert' })
    expect((await ui.find({ key: 'revert' }))?.props).toMatchObject({ variant: 'primary', label: 'confirm: revert a1 on main?' })
    expect((await ui.find({ key: 'merge' }))?.props.variant).toBeUndefined()
    await ui.press({ key: 'hash-a1' })
  }
})

test('the keys answer with the settings closed: their buttons stay in the header', async ($, on) => {
  world(on)
  await $.command.run(typed(''))
  for (const surface of [...SURFACES, 'mobile'] as const) {
    const ui = await $.ui.mount({ plugin: 'git-graph', surface, component: 'Pane', requestId: 'git-graph', props: PANE_PROPS })
    expect(await ui.find({ key: 'settings-panel' })).toBeUndefined()
    // Mobile draws no find field, so no s
    const hotkeys = { next: 'j', previous: 'k', head: 'h', fetch: 'f', reload: 'r', ...(surface === 'mobile' ? {} : { 'focus-find': 's' }) }
    for (const [key, hotkey] of Object.entries(hotkeys)) {
      expect((await ui.find({ key }))?.props.hotkey).toBe(hotkey)
    }
    const all = (await ui.findAll({ type: 'Button' })).map(button => button.props.hotkey).filter(Boolean)
    expect(all.sort()).toEqual(Object.values(hotkeys).sort())
    // The branch in the header is text, with no key chip beside it; HEAD sits with the walk's arrows
    expect(await ui.find({ type: 'Text', text: '⎇ main' })).toBeDefined()
    expect((await ui.find({ key: 'head' }))?.props.label).toBe('HEAD')
    // No row of keys at the bottom any more
    expect(await ui.find({ key: 'keys' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /esc/ })).toBeUndefined()
  }
})

test('the settings panel draws a line per group', async ($, on) => {
  world(on)
  await $.command.run(typed(''))
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    await ui.press({ key: 'settings' })
    expect((await ui.find({ key: 'settings-panel' }))?.props.borderStyle).toBe('round')
    for (const label of ['Lanes', 'Columns', 'Dim']) expect(await ui.find({ type: 'Text', text: label })).toBeDefined()
    expect((await ui.find({ key: 'setting-columns' }))?.text).toContain('☑ author')
    expect((await ui.find({ key: 'setting-dim' }))?.text).toContain('☑ merge commits')
    // The keys are no group of their own: each header button tells its own
    expect(await ui.find({ type: 'Text', text: 'Keys' })).toBeUndefined()
    await ui.press({ key: 'settings' })
    expect(await ui.find({ key: 'settings-panel' })).toBeUndefined()
  }
})

test('each header button says what it does, under the pointer', async ($, on) => {
  world(on)
  await $.command.run(typed(''))
  const ui = await mount($, 'desktop')
  for (const [key, tip] of [['fetch', 'Fetch every remote and its tags · F'], ['next', 'Open the commit below · J'], ['head', 'Open the commit HEAD points at · H'], ['focus-find', 'Find by message, author, hash or branch · S']]) {
    expect(await ui.find({ key })).toBeDefined()
    // A hidden card beside the button, shown while the button's hover scope (tip-<key>) is lit;
    // the kit describes neither element's hover, so the card is found by what it says
    const card = (await ui.findAll({ type: 'Box' })).find(box => box.props.display === 'none' && box.text === ` ${tip} `)
    expect(card?.props).toMatchObject({ position: 'absolute', display: 'none', top: 1 })
  }
})

test('a checkout is a toast, not a line repeating the branch the header shows', async ($, on) => {
  const seen = world(on)
  await $.command.run(typed(''))
  const ui = await mount($, 'desktop')
  await ui.press({ key: 'ref-local-feature' })
  await ui.press({ key: 'checkout-ref' })
  await ui.press({ key: 'checkout-ref' })
  expect(seen.git.findLast(args => args[0] === 'switch')).toEqual(['switch', 'feature'])
  expect(seen.toasts.at(-1)).toBe('Git Graph · checked out feature')
  expect(await ui.find({ type: 'Text', text: /checked out/ })).toBeUndefined()
})

test('an error stays under the header, with a toast', async ($, on) => {
  const seen = world(on, { status: ' M a.ts\n' })
  await $.command.run(typed(''))
  const ui = await mount($, 'terminal')
  await ui.press({ key: 'ref-local-feature' })
  await ui.press({ key: 'checkout-ref' })
  await ui.press({ key: 'checkout-ref' })
  expect((await ui.find({ type: 'Text', text: 'uncommitted changes: commit or stash them first' }))?.props.color).toBe('red')
  expect(seen.toasts.at(-1)).toBe('Git Graph · uncommitted changes: commit or stash them first')
})

/** A long straight history, `count` commits, the newest first. */
const longLog = (count: number) => Array.from({ length: count }, (_, i) => {
  const n = count - i
  return [`c${n}`, n > 1 ? `c${n - 1}` : '', n === count ? 'HEAD -> main, origin/main' : '', i % 3 === 0 ? 'Ana' : 'Alvaro', '19 Oct 2026 10:00', `commit number ${n}`].join(SEP)
}).join('\n')

test('rows come a page at a time: older and newer replace them', async ($, on) => {
  world(on, { log: longLog(95), 'rev-parse': args => (args[0] === '--show-toplevel' ? `${CWD}\n` : 'c95\n') })
  await $.command.run(typed(''))
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    expect(await ui.find({ type: 'Text', text: '1–40 of 95' })).toBeDefined()
    expect(await ui.find({ key: 'newer' })).toBeUndefined()
    await ui.press({ key: 'older' })
    expect(await ui.find({ type: 'Text', text: '41–80 of 95' })).toBeDefined()
    expect(await ui.find({ key: 'hash-c95' })).toBeUndefined()
    expect(await ui.find({ key: 'hash-c55' })).toBeDefined()
    await ui.press({ key: 'older' })
    expect(await ui.find({ type: 'Text', text: '81–95 of 95' })).toBeDefined()
    expect(await ui.find({ key: 'older' })).toBeUndefined()
    await ui.press({ key: 'newer' })
    await ui.press({ key: 'newer' })
    expect(await ui.find({ type: 'Text', text: '1–40 of 95' })).toBeDefined()
  }
})

test('j and k turn the page at its edges; with nothing open they start at its top', async ($, on) => {
  world(on, { log: longLog(95), 'rev-parse': args => (args[0] === '--show-toplevel' ? `${CWD}\n` : 'c95\n') })
  await $.command.run(typed(''))
  const ui = await mount($, 'desktop')
  // k with nothing open opens the first row, not the last commit of the history
  await ui.press({ key: 'previous' })
  expect((await ui.find({ key: 'hash-c95' }))?.props.dimColor).toBe(false)
  await ui.press({ key: 'hash-c95' })
  await ui.press({ key: 'older' })
  await ui.press({ key: 'next' })
  expect((await ui.find({ key: 'hash-c55' }))?.props.dimColor).toBe(false)
  await ui.press({ key: 'previous' })
  // c56 is the last row of the first page: the walk turned back to it
  expect(await ui.find({ type: 'Text', text: '1–40 of 95' })).toBeDefined()
  expect((await ui.find({ key: 'hash-c56' }))?.props.dimColor).toBe(false)
})

test('what a page sends the surface stays small, an open commit included', async ($, on) => {
  world(on, { log: longLog(95), 'rev-parse': args => (args[0] === '--show-toplevel' ? `${CWD}\n` : 'c95\n') })
  await $.command.run(typed(''))
  const ui = await mount($, 'desktop')
  await ui.press({ key: 'hash-c90' })
  // Every row's SVGs ride along on every redraw: 40 rows with curves and avatars stay under 100k
  expect(JSON.stringify(await ui.drawn()).length).toBeLessThan(100000)
  await ui.press({ key: 'older' })
  await ui.press({ key: 'older' })
  expect(JSON.stringify(await ui.drawn()).length).toBeLessThan(100000)
})

test('hiding the author keeps the avatars, and hiding the avatars keeps the author', async ($, on) => {
  world(on)
  await $.command.run(typed(''))
  const desktop = await mount($, 'desktop')
  const avatars = async () => (await desktop.findAll({ type: 'Svg' })).map(svg => svg.props.alt).filter(alt => alt !== 'graph')
  await desktop.press({ key: 'settings' })
  await desktop.press({ key: 'show-author' })
  expect(await desktop.find({ type: 'Text', text: 'Ana' })).toBeUndefined()
  expect(await avatars()).toEqual(['AN', 'AL', 'AL'])
  await desktop.press({ key: 'show-author' })
  await desktop.press({ key: 'avatars' })
  expect(await avatars()).toEqual([])
  expect(await desktop.find({ type: 'Text', text: 'Ana' })).toBeDefined()
})
