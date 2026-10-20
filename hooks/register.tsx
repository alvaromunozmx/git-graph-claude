// Git Graph as a Claude Code mod.
//
// - /git-graph opens a pane with the repo's history laid out in lanes, like the VS Code
//   extension: branches, remotes and tags as badges, author, date and hash per commit.
// - Click a branch or tag badge for its actions: checkout, merge, rebase, rename, push, pull,
//   delete, fetch, copy the name, and a link to open a pull request on GitHub, GitLab or Bitbucket.
// - Click a hash to open that commit under its row: who signed it, its files and a row of actions. Mark one
//   to compare, and every commit opened next lists what changed between the two.
//   Click a file to read its diff right there.
// - Actions that change the repo (checkout, cherry-pick, revert, merge, rebase, reset) ask for
//   a second click to confirm; a tag is named in a field under the commit;
//   "new branch" hands the task to Claude, so it asks for the name and its own permission.
// - ⇣ fetch brings every remote's branches and tags, pruning the ones deleted there.
// - A repo with submodules gets a repo picker: each submodule's history draws the same way.
// - The branch picker draws every branch, the current one, or any one branch alone, local
//   branches listed apart from remote ones.
// - The find field keeps only the commits whose message, author, hash or refs hold the text.
// - Uncommitted changes get a row of their own above the commit they would follow; stashes
//   fork off the commit they were made on, to apply, pop, drop or branch from.
// - The settings (lanes, columns, avatars, date format, what is dim) are kept between sessions;
//   ⚙ opens them as a panel, a line per group.
// - Keys, while the pane has the focus: j and k walk the commits (↓ ↑ in the header), h goes to
//   HEAD (the branch name), s finds (⌕), f fetches, r reloads; Esc closes the pane. The settings
//   list them; the Buttons they press stay in the header, since a hotkey needs its Button drawn.
// - A success is a toast; the line under the header keeps errors and what is under way.
// - Where the surface draws SVG (desktop), the lanes are curves, an SVG per row; the terminal
//   draws them with box-drawing glyphs, which join there.
// - The graph reloads after every turn, so commits Claude makes show up on their own.
import { atom, read } from 'claude-code'
import type { EngineInterface, EventOf, Register } from 'claude-code'

import { checkoutCommit, checkoutRemote, git as cmd, splitRemote } from './commands'
import { ancestorsOf, avatarOf, colorIndexOf, commitUrl, CURVE_CELL, curvesOf, DATE_ARGS, describeSignature, describeUpstream, FORMAT, forgeOf, glyphOf, goesDown, initialsOf, layout, linesDownOf, linkify, matches, parseDiff, parseLog, parseNameStatus, parseNumstat, parseStashes, parseStatus, parseSubmodules, parseTagInput, parseUpstreams, pullRequestUrl, SEP, SIGNATURE_FORMAT, splitBranches, splitMatch, STASH_FORMAT, summary, UPSTREAM_FORMAT, withStashes, withStats, WORKTREE, worktreeRow } from './graph'
import type { Cell, Commit, CommitAction, DateFormat, Detail, Diff, FileChange, Graph, Note, Pending, Ref, RefAction, ResetMode, StashAction } from '../types'

type Engine = EngineInterface
type RenderOf<C extends string> = Extract<EventOf['ui.render'], { component: C }>
/** The element table of the surface drawing the pane. */
type Ui = any

const PANE = 'git-graph'
// Rows drawn at once: older and newer pages replace them. Every row goes to the surface on each
// redraw, so the page keeps that bounded however long the history is
const PAGE = 40

const GRAPH_REF = { plugin: 'git-graph', key: 'graph' } as const
const SELECTED_REF = { plugin: 'git-graph', key: 'selected' } as const
const DETAIL_REF = { plugin: 'git-graph', key: 'detail' } as const
const DIFF_REF = { plugin: 'git-graph', key: 'diff' } as const
const ALL_REF = { plugin: 'git-graph', key: 'allBranches' } as const
const FILTER_REF = { plugin: 'git-graph', key: 'branchFilter' } as const
const REPO_REF = { plugin: 'git-graph', key: 'repo' } as const
const PICKER_REDRAW_REF = { plugin: 'git-graph', key: 'pickerRedraw' } as const
const PAGE_START_REF = { plugin: 'git-graph', key: 'pageStart' } as const
const COMPACT_REF = { plugin: 'git-graph', key: 'compact' } as const
const SETTINGS_REF = { plugin: 'git-graph', key: 'settingsOpen' } as const
const MUTE_MERGES_REF = { plugin: 'git-graph', key: 'muteMerges' } as const
const CURVES_REF = { plugin: 'git-graph', key: 'curves' } as const
const AVATARS_REF = { plugin: 'git-graph', key: 'avatars' } as const
const SHOW_AUTHOR_REF = { plugin: 'git-graph', key: 'showAuthor' } as const
const SHOW_DATE_REF = { plugin: 'git-graph', key: 'showDate' } as const
const DATE_FORMAT_REF = { plugin: 'git-graph', key: 'dateFormat' } as const
const MUTE_OTHERS_REF = { plugin: 'git-graph', key: 'muteOthers' } as const
const PENDING_REF = { plugin: 'git-graph', key: 'pending' } as const
const NOTE_REF = { plugin: 'git-graph', key: 'note' } as const
const QUERY_REF = { plugin: 'git-graph', key: 'query' } as const
const TAGGING_REF = { plugin: 'git-graph', key: 'tagging' } as const
const REF_REF = { plugin: 'git-graph', key: 'ref' } as const
const STASHING_REF = { plugin: 'git-graph', key: 'stashing' } as const
const COMPARE_REF = { plugin: 'git-graph', key: 'compareBase' } as const
const RENAMING_REF = { plugin: 'git-graph', key: 'renaming' } as const
const GRAPH = atom(GRAPH_REF, null)
const SELECTED = atom(SELECTED_REF, null)
const DETAIL = atom(DETAIL_REF, null)
const DIFF = atom(DIFF_REF, null)
const ALL = atom(ALL_REF, true)
const FILTER = atom(FILTER_REF, null)
const REPO = atom(REPO_REF, null)
const PICKER_REDRAW = atom(PICKER_REDRAW_REF, 0)
const PAGE_START = atom(PAGE_START_REF, 0)
const COMPACT = atom(COMPACT_REF, false)
const SETTINGS = atom(SETTINGS_REF, false)
const MUTE_MERGES = atom(MUTE_MERGES_REF, true)
// Curves by default: in a proportional font with tall rows, glyphs cannot join from row to row
const CURVES = atom(CURVES_REF, true)
const AVATARS = atom(AVATARS_REF, true)
const SHOW_AUTHOR = atom(SHOW_AUTHOR_REF, true)
const SHOW_DATE = atom(SHOW_DATE_REF, true)
const DATE_FORMAT = atom(DATE_FORMAT_REF, 'absolute' as DateFormat)
const DATE_FORMATS: DateFormat[] = ['absolute', 'relative', 'iso']
const MUTE_OTHERS = atom(MUTE_OTHERS_REF, false)
const PENDING = atom(PENDING_REF, null)
const NOTE = atom(NOTE_REF, null)
const QUERY = atom(QUERY_REF, '')
const TAGGING = atom(TAGGING_REF, null)
const REF = atom(REF_REF, null)
const STASHING = atom(STASHING_REF, null)
const COMPARE = atom(COMPARE_REF, null)
const RENAMING = atom(RENAMING_REF, null)

// One color per lane, cycling, like Git Graph's palette
const LANE_COLORS = ['blue', 'magenta', 'green', 'yellow', 'cyan', 'red']
const REF_COLOR: Record<Ref['kind'], string> = { head: 'green', local: 'blue', remote: 'magenta', tag: 'yellow' }
const NOTE_COLOR: Record<Note['kind'], string> = { ok: 'green', error: 'red', info: 'cyan' }
const AUTHOR_WIDTH = 14
const DATE_WIDTH = 17
const HASH_WIDTH = 7
// What a row's lanes say to a reader that cannot see them
const LANES_ALT = 'graph'
// How far the lanes beside an open panel reach: the panel's own height clips them
const PANEL_ROWS = 200
const LANE_DOWN = Array.from({ length: PANEL_ROWS }, () => '│').join('\n')
// An avatar and the space after it
const AVATAR_WIDTH = 3
// The settings' group names, in a column of their own
const SETTING_LABEL_WIDTH = 8

let limit = 150
let isOpen = false
let isBusy = false
let loading: Promise<void> | null = null

export const register: Register = (on, options) => {
  limit = Math.max(20, Number(options.limit) || 150)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'git-graph',
      description: 'Open the Git Graph pane · all: every branch · current: only this one',
      argumentHint: '[all | current]',
      immediate: true
    })
    await loadSettings($)
    return next(e)
  })

  on('command.run', { command: 'git-graph' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'all' || arg === 'current') {
      await $.state.set(ALL_REF, arg === 'all')
      await $.state.set(FILTER_REF, null)
    } else if (arg !== '') return { text: 'Usage: /git-graph [all | current]' }
    await reload($)
    isOpen = true
    await $.ui.open({ id: PANE, title: 'Git Graph', focus: true, closeOnEscape: true })
    // The pane is the answer: nothing for the transcript or the model
    return {}
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) isBusy = true
    return next(e)
  })

  // Claude may have committed, switched branches or pulled: draw the history again
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) {
      isBusy = false
      if (isOpen) await reload($)
    }
    return result
  })

  // A drawing that throws leaves the pane empty: show the error in it instead
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    try {
      return await drawPane($, e)
    } catch (error) {
      const message = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error)
      $.ui.log(`git-graph: ${message}`, { to: 'debug' })
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box flexDirection="column">
          <Text color="red">git-graph could not draw the pane:</Text>
          {message.split('\n').slice(0, 12).map((line, i) => <Text key={`err-${i}`} dimColor wrap="truncate-end">{line || ' '}</Text>)}
        </Box>
      )
    }
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    isOpen = false
    await clearSelection($)
    await $.state.set(PAGE_START_REF, 0)
    await $.state.set(NOTE_REF, null)
    await $.state.set(QUERY_REF, '')
    await $.state.set(REF_REF, null)
    await $.state.set(COMPARE_REF, null)
    return next(e)
  })
}

// ── Reading the repo ───────────────────────────────────────────────────────────

/** Runs git in the repo drawn: the session's, or the submodule picked. */
async function git ($: Engine, args: string[], okCodes: number[] = [0], timeoutMs?: number) {
  return gitIn($, (await read($, REPO)) ?? (await $.session.cwd()), args, okCodes, timeoutMs)
}

async function gitIn ($: Engine, cwd: string, args: string[], okCodes: number[] = [0], timeoutMs?: number) {
  // A remote that wants a password fails at once instead of waiting for one nobody can type
  const result = await $.process.run(['git', '-C', cwd, ...args], { env: { GIT_TERMINAL_PROMPT: '0' }, ...(timeoutMs ? { timeoutMs } : {}) })
  if (!okCodes.includes(result.exitCode)) throw new Error((result.stderr || result.stdout).trim() || `git ${args[0]} failed`)
  return result.stdout
}

function reload ($: Engine): Promise<void> {
  // Two turns ending close together share one load
  loading ??= load($).finally(() => { loading = null })
  return loading
}

async function load ($: Engine) {
  const allBranches = await read($, ALL)
  const dateFormat = await read($, DATE_FORMAT)
  let filter = await read($, FILTER)
  let graph: Graph
  try {
    const [local, remote] = splitBranches(await git($, ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes']).catch(() => ''))
    const branches = [...local, ...remote]
    const upstreams = parseUpstreams(await git($, ['for-each-ref', `--format=${UPSTREAM_FORMAT}`, 'refs/heads']).catch(() => ''))
    // A picked branch that was deleted since: back to the branches the toggle says
    if (filter !== null && !branches.includes(filter)) {
      filter = null
      await $.state.set(FILTER_REF, null)
    }
    const [remoteList, branch, head, status, stashList, log] = await Promise.all([
      git($, ['remote']),
      git($, ['branch', '--show-current']).catch(() => ''),
      git($, ['rev-parse', 'HEAD']).catch(() => ''),
      git($, ['status', '--porcelain=v1', '-uall']).catch(() => ''),
      // Stashes belong with every branch, not with one drawn alone
      filter === null && allBranches ? git($, ['stash', 'list', `--format=${STASH_FORMAT}`, DATE_ARGS[dateFormat]]).catch(() => '') : Promise.resolve(''),
      git($, [
        // The stash ref is drawn from the stash list instead, one row per stash
        'log', ...(filter !== null ? [filter] : allBranches ? ['--exclude=refs/stash', '--all'] : []), '--topo-order', `-n${limit}`,
        `--format=${FORMAT}`, DATE_ARGS[dateFormat], '--'
      ])
    ])
    const repos = await listRepos($)
    const remotes = remoteList.split('\n').map(name => name.trim()).filter(Boolean).sort((a, b) => Number(b === 'origin') - Number(a === 'origin'))
    const forge = remotes[0] ? forgeOf(await git($, ['remote', 'get-url', remotes[0]]).catch(() => '')) : null
    // Where pull requests go: the remote's HEAD, else main or master, whichever exists
    const remoteHead = remotes[0] ? (await git($, ['symbolic-ref', '--short', `refs/remotes/${remotes[0]}/HEAD`]).catch(() => '')).trim() : ''
    const defaultBranch = remoteHead ? remoteHead.slice(remoteHead.indexOf('/') + 1) : branches.includes('master') && !branches.includes('main') ? 'master' : 'main'
    const parsed = withStashes(parseLog(log, new Set(remotes)), parseStashes(stashList))
    const changes = parseStatus(status)
    // The uncommitted row leads to HEAD, so the layout draws its line down to it
    const headHash = head.trim()
    if (changes.length > 0) parsed.unshift(worktreeRow(changes, parsed.some(commit => commit.hash === headHash) ? headHash : null))
    graph = {
      commits: layout(parsed),
      branch: branch.trim() || '(detached HEAD)',
      changes,
      branches,
      localCount: local.length,
      upstreams,
      remotes,
      head: headHash,
      forge,
      defaultBranch,
      repos,
      error: null,
      loadedAt: await $.clock.now()
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    graph = { commits: [], branch: '', changes: [], branches: [], localCount: 0, upstreams: {}, remotes: [], head: '', forge: null, defaultBranch: 'main', repos: await listRepos($).catch(() => []), error: /not a git repository/i.test(message) ? 'This folder is not a git repository.' : message, loadedAt: await $.clock.now() }
  }
  await $.state.set(GRAPH_REF, graph)

  // A selected commit or badge that is no longer in the graph loses its details
  const selected = await read($, SELECTED)
  if (selected && !graph.commits.some(commit => commit.hash === selected)) await clearSelection($)
  const ref = await read($, REF)
  if (ref && !graph.commits.some(commit => commit.refs.some(item => item.kind === ref.kind && item.name === ref.name))) await selectRef($, null)
}

async function clearSelection ($: Engine) {
  await $.state.set(SELECTED_REF, null)
  await $.state.set(DETAIL_REF, null)
  await $.state.set(DIFF_REF, null)
  await $.state.set(PENDING_REF, null)
  await $.state.set(TAGGING_REF, null)
  await $.state.set(STASHING_REF, null)
}

async function select ($: Engine, hash: string) {
  if ((await read($, SELECTED)) === hash) return clearSelection($)
  await openCommit($, hash)
}

/** Opens a commit's detail, closing whichever was open. */
async function openCommit ($: Engine, hash: string) {
  await $.state.set(SELECTED_REF, hash)
  await $.state.set(PENDING_REF, null)
  await $.state.set(DIFF_REF, null)
  await $.state.set(TAGGING_REF, null)
  await $.state.set(DETAIL_REF, { hash, meta: '', message: '', files: [], isLoading: true })
  const detail = await readDetail($, hash)
  if ((await read($, SELECTED)) === hash) await $.state.set(DETAIL_REF, detail)
}

async function readDetail ($: Engine, hash: string): Promise<NonNullable<Detail>> {
  const graph = await read($, GRAPH)
  const base = await read($, COMPARE)
  if (base !== null && base !== hash && graph) return readComparison($, graph, base, hash)
  if (hash === WORKTREE) {
    const stats = parseNumstat(await git($, ['diff', '--numstat', '-M', 'HEAD']).catch(() => ''))
    const files = withStats(graph?.changes ?? [], stats)
    return { hash, meta: `${summary(files)} in the working tree`, message: '', files }
  }
  const parent = graph?.commits.find(commit => commit.hash === hash)?.parents[0]
  try {
    // A merge is shown against its first parent, as Git Graph does
    const range = parent ? [parent, hash] : ['--root', hash]
    const [shown, names, numstat] = await Promise.all([
      // The first line is the signature, as git checks it (gpg or ssh, where they are set up)
      git($, ['show', '-s', `--format=${SIGNATURE_FORMAT}%n%an <%ae> · %ad%n%B`, '--date=format:%d %b %Y %H:%M', hash]),
      git($, ['diff-tree', '-r', '-M', '--name-status', '--no-commit-id', ...range]),
      git($, ['diff-tree', '-r', '-M', '--numstat', '--no-commit-id', ...range]).catch(() => '')
    ])
    let lines = shown.trimEnd().split('\n')
    let signature
    if (lines[0]?.includes(SEP)) {
      const [status = '', signer = '', key = ''] = lines[0].split(SEP)
      signature = describeSignature(status, signer, key)
      lines = lines.slice(1)
    }
    const [meta = '', ...message] = lines
    const files = withStats(parseNameStatus(names), parseNumstat(numstat))
    return { hash, meta: `${meta}  ·  ${summary(files)}`, message: message.join('\n').trim(), files, ...(signature ? { signature } : {}) }
  } catch (error) {
    return { hash, meta: `Could not read the commit: ${error instanceof Error ? error.message : String(error)}`, message: '', files: [] }
  }
}

/** What changed from the older of two rows to the newer: the working tree is the newest of all. */
async function readComparison ($: Engine, graph: Graph, base: string, hash: string): Promise<NonNullable<Detail>> {
  const order = (target: string) => graph.commits.findIndex(commit => commit.hash === target)
  const [from, to] = order(base) > order(hash) ? [base, hash] : [hash, base]
  const label = (target: string) => (target === WORKTREE ? 'the working tree' : target.slice(0, HASH_WIDTH))
  try {
    const range = [from, ...(to === WORKTREE ? [] : [to])]
    const [names, numstat] = await Promise.all([
      git($, ['diff', '--name-status', '-M', ...range]),
      git($, ['diff', '--numstat', '-M', ...range]).catch(() => '')
    ])
    const files = withStats(parseNameStatus(names), parseNumstat(numstat))
    return { hash, meta: `${summary(files)} from ${label(from)} to ${label(to)}`, message: '', files, compare: { from, to } }
  } catch (error) {
    return { hash, meta: `Could not compare them: ${error instanceof Error ? error.message : String(error)}`, message: '', files: [] }
  }
}

/** Marks this commit to compare others with, or stops comparing when it is the one marked. */
async function toggleCompare ($: Engine, hash: string) {
  const base = await read($, COMPARE)
  // The header's comparing line says so: no note repeats it
  await $.state.set(COMPARE_REF, base === hash ? null : hash)
}

async function stopComparing ($: Engine) {
  await $.state.set(COMPARE_REF, null)
  const selected = await read($, SELECTED)
  if (selected) {
    await $.state.set(DIFF_REF, null)
    await $.state.set(DETAIL_REF, await readDetail($, selected))
  }
}

/** The rows the pane draws now: the ones the find field keeps, up to the page shown. */
async function visibleRows ($: Engine) {
  const graph = await read($, GRAPH)
  const query = (await read($, QUERY)).trim()
  return (graph?.commits ?? []).filter(commit => query === '' || matches(commit, query))
}

/** j and k: open the next or the previous row, showing another page when the walk reaches it. */
async function step ($: Engine, by: 1 | -1) {
  const rows = await visibleRows($)
  if (rows.length === 0) return
  const selected = await read($, SELECTED)
  const at = rows.findIndex(commit => commit.hash === selected)
  // With nothing open, either key starts at the top of the page drawn
  const next = at === -1 ? Math.min(rows.length - 1, await read($, PAGE_START)) : Math.min(rows.length - 1, Math.max(0, at + by))
  await reveal($, next)
  const target = rows[next]
  if (target && target.hash !== selected) await openCommit($, target.hash)
}

/** h: open the commit HEAD points at. */
async function goHead ($: Engine) {
  const rows = await visibleRows($)
  const at = rows.findIndex(commit => commit.refs.some(ref => ref.kind === 'head'))
  if (at === -1) return note($, 'info', 'HEAD is not among the commits drawn')
  await reveal($, at)
  const target = rows[at]
  if (target && target.hash !== (await read($, SELECTED))) await openCommit($, target.hash)
}

/** Turns to the page that draws the row at `index`. */
async function reveal ($: Engine, index: number) {
  const start = Math.floor(index / PAGE) * PAGE
  if (start !== (await read($, PAGE_START))) await $.state.set(PAGE_START_REF, start)
}

/** s: the focus goes to the find field. */
async function focusFind ($: Engine) {
  await $.ui.focus({ requestId: PANE, key: 'find' }).catch(() => undefined)
}

/** Opens one file's diff under it, or closes it when it is the one open. */
async function toggleDiff ($: Engine, hash: string, file: FileChange) {
  const open = await read($, DIFF)
  if (open && open.hash === hash && open.path === file.path) return $.state.set(DIFF_REF, null)
  await $.state.set(DIFF_REF, { hash, path: file.path, hunks: '', isLoading: true })
  const diff = await readDiff($, hash, file)
  const now = await read($, DIFF)
  if (now?.hash === hash && now.path === file.path) await $.state.set(DIFF_REF, diff)
}

async function readDiff ($: Engine, hash: string, file: FileChange): Promise<NonNullable<Diff>> {
  const paths = ['--', ...(file.oldPath ? [file.oldPath] : []), file.path]
  try {
    let stdout: string
    const detail = await read($, DETAIL)
    const compare = detail?.hash === hash ? detail.compare : undefined
    if (compare) {
      stdout = await git($, ['diff', '-M', compare.from, ...(compare.to === WORKTREE ? [] : [compare.to]), ...paths])
    } else if (hash === WORKTREE) {
      // An untracked file is new against nothing; `--no-index` exits 1 when they differ
      stdout = file.status === '?'
        ? await git($, ['diff', '--no-index', '--', '/dev/null', file.path], [0, 1])
        : await git($, ['diff', '-M', 'HEAD', ...paths]).catch(() => git($, ['diff', '--cached', '-M', ...paths]))
    } else {
      const graph = await read($, GRAPH)
      const parent = graph?.commits.find(commit => commit.hash === hash)?.parents[0]
      stdout = parent
        ? await git($, ['diff', '-M', parent, hash, ...paths])
        : await git($, ['show', '--format=', '-M', hash, ...paths])
    }
    return { hash, path: file.path, ...parseDiff(stdout) }
  } catch (error) {
    return { hash, path: file.path, hunks: '', note: `Could not read the diff: ${error instanceof Error ? error.message : String(error)}` }
  }
}

// One function per value: $.state.set only takes a reference named in this file
async function toggleAll ($: Engine) {
  await $.state.set(ALL_REF, !(await read($, ALL)))
  await $.state.set(FILTER_REF, null)
  await reload($)
}

/** The session's repo, then each submodule checked out in it, deepest last. */
async function listRepos ($: Engine) {
  const cwd = await $.session.cwd()
  const root = (await gitIn($, cwd, ['rev-parse', '--show-toplevel']).catch(() => '')).trim()
  if (root === '') return []
  const submodules = parseSubmodules(await gitIn($, root, ['submodule', 'status', '--recursive']).catch(() => ''))
  return [{ path: root, label: root.split('/').at(-1) ?? root }, ...submodules.map(path => ({ path: `${root}/${path}`, label: path }))]
}

/** Draws another repo: what was open, picked or compared there does not carry over. */
async function pickRepo ($: Engine, path: string) {
  const graph = await read($, GRAPH)
  await $.state.set(REPO_REF, path === graph?.repos[0]?.path ? null : path)
  await $.state.set(FILTER_REF, null)
  await $.state.set(COMPARE_REF, null)
  await $.state.set(REF_REF, null)
  await $.state.set(PAGE_START_REF, 0)
  await clearSelection($)
  await reload($)
}

/** The branch picker's value: `all`, `current`, or `ref:<branch>` to draw that branch alone. */
async function pickBranches ($: Engine, value: string) {
  // A separator picks nothing: the picker draws again with what it showed
  if (value.startsWith('sep:')) return $.state.set(PICKER_REDRAW_REF, (await read($, PICKER_REDRAW)) + 1)
  if (value === 'all' || value === 'current') {
    await $.state.set(ALL_REF, value === 'all')
    await $.state.set(FILTER_REF, null)
  } else {
    await $.state.set(FILTER_REF, value.slice(4))
  }
  await $.state.set(PAGE_START_REF, 0)
  await reload($)
}

async function find ($: Engine, value: string) {
  // Kept as typed: the field is drawn from it, and a trimmed space would vanish while typing
  await $.state.set(QUERY_REF, value)
  await $.state.set(PAGE_START_REF, 0)
}

async function toggleCompact ($: Engine) {
  await $.state.set(COMPACT_REF, !(await read($, COMPACT)))
  await saveSettings($)
}

async function toggleShowAuthor ($: Engine) {
  await $.state.set(SHOW_AUTHOR_REF, !(await read($, SHOW_AUTHOR)))
  await saveSettings($)
}

async function toggleShowDate ($: Engine) {
  await $.state.set(SHOW_DATE_REF, !(await read($, SHOW_DATE)))
  await saveSettings($)
}

/** absolute → relative → iso: the dates are read again from git in the new format. */
async function cycleDateFormat ($: Engine) {
  const now = await read($, DATE_FORMAT)
  await $.state.set(DATE_FORMAT_REF, DATE_FORMATS[(DATE_FORMATS.indexOf(now) + 1) % DATE_FORMATS.length] ?? 'absolute')
  await saveSettings($)
  await reload($)
}

/** The settings, kept in the plugin's store so the next session draws the same way. */
async function saveSettings ($: Engine) {
  const settings = {
    compact: await read($, COMPACT),
    curves: await read($, CURVES),
    avatars: await read($, AVATARS),
    showAuthor: await read($, SHOW_AUTHOR),
    showDate: await read($, SHOW_DATE),
    dateFormat: await read($, DATE_FORMAT),
    muteMerges: await read($, MUTE_MERGES),
    muteOthers: await read($, MUTE_OTHERS)
  }
  await $.store.set('settings', settings).catch(() => undefined)
}

/** Reads the kept settings back; a value of the wrong kind keeps its default. */
async function loadSettings ($: Engine) {
  const saved = await $.store.get('settings').catch(() => undefined)
  if (typeof saved !== 'object' || saved === null) return
  const value = saved as Record<string, unknown>
  const flag = (key: string) => (typeof value[key] === 'boolean' ? value[key] as boolean : undefined)
  const compact = flag('compact')
  if (compact !== undefined) await $.state.set(COMPACT_REF, compact)
  const curves = flag('curves')
  if (curves !== undefined) await $.state.set(CURVES_REF, curves)
  const avatars = flag('avatars')
  if (avatars !== undefined) await $.state.set(AVATARS_REF, avatars)
  const showAuthor = flag('showAuthor')
  if (showAuthor !== undefined) await $.state.set(SHOW_AUTHOR_REF, showAuthor)
  const showDate = flag('showDate')
  if (showDate !== undefined) await $.state.set(SHOW_DATE_REF, showDate)
  const muteMerges = flag('muteMerges')
  if (muteMerges !== undefined) await $.state.set(MUTE_MERGES_REF, muteMerges)
  const muteOthers = flag('muteOthers')
  if (muteOthers !== undefined) await $.state.set(MUTE_OTHERS_REF, muteOthers)
  const dateFormat = DATE_FORMATS.find(format => format === value.dateFormat)
  if (dateFormat) await $.state.set(DATE_FORMAT_REF, dateFormat)
}

async function toggleSettings ($: Engine) {
  await $.state.set(SETTINGS_REF, !(await read($, SETTINGS)))
}

async function toggleCurves ($: Engine) {
  await $.state.set(CURVES_REF, !(await read($, CURVES)))
  await saveSettings($)
}

async function toggleAvatars ($: Engine) {
  await $.state.set(AVATARS_REF, !(await read($, AVATARS)))
  await saveSettings($)
}

async function toggleMuteMerges ($: Engine) {
  await $.state.set(MUTE_MERGES_REF, !(await read($, MUTE_MERGES)))
  await saveSettings($)
}

async function toggleMuteOthers ($: Engine) {
  await $.state.set(MUTE_OTHERS_REF, !(await read($, MUTE_OTHERS)))
  await saveSettings($)
}

/**
 * Says how an action went. A success is a toast alone: the pane already shows what it changed (the
 * branch in the header, a new row), so a line under the header would only repeat it. An error stays
 * there, with a toast too, until the next action; info (fetching…, asked Claude) only there.
 */
async function note ($: Engine, kind: Note['kind'], text: string) {
  await $.state.set(NOTE_REF, kind === 'ok' ? null : { kind, text })
  if (kind !== 'info') $.ui.toast(`Git Graph · ${text}`)
}

// ── Actions ────────────────────────────────────────────────────────────────────

async function copyText ($: Engine, text: string, what: string) {
  const platform = (await $.process.run(['uname', '-s']).catch(() => undefined))?.stdout.trim()
  const argv = platform === 'Darwin'
    ? ['sh', '-c', 'printf %s "$GG_TEXT" | pbcopy']
    : platform === 'Linux'
      ? ['sh', '-c', 'printf %s "$GG_TEXT" | (wl-copy 2>/dev/null || xclip -selection clipboard 2>/dev/null || xsel -b)']
      : ['cmd', '/c', 'echo|set /p="%GG_TEXT%"| clip']
  const result = await $.process.run(argv, { env: { GG_TEXT: text } }).catch(() => undefined)
  if (result?.exitCode === 0) await note($, 'ok', `copied ${what}`)
  else await note($, 'error', 'could not reach the clipboard')
}

/** The words an action's confirming button asks with. */
function confirmText (action: CommitAction, commit: Commit, graph: Graph): string {
  const short = commit.hash.slice(0, HASH_WIDTH)
  const branch = graph.branch
  switch (action) {
    case 'checkout': return `confirm: checkout ${checkoutCommit(commit, graph.remotes, graph.branches).label}?`
    case 'cherry-pick': return `confirm: cherry-pick onto ${branch}?`
    case 'revert': return `confirm: revert ${short} on ${branch}?`
    case 'merge': return `confirm: merge ${mergeTarget(commit)} into ${branch}?`
    case 'rebase': return `confirm: rebase ${branch} onto ${short}?`
    case 'reset': return `reset ${branch} to ${short}:`
  }
}

/** What a merge names: the commit's branch when it has one, so the message reads well. */
function mergeTarget (commit: Commit): string {
  return commit.refs.find(ref => ref.kind === 'local' || ref.kind === 'remote')?.name ?? commit.hash.slice(0, HASH_WIDTH)
}

/** First click arms the action, the second one runs it. */
async function arm ($: Engine, action: CommitAction, hash: string) {
  const pending = await read($, PENDING)
  if (!pending || pending.action !== action || pending.hash !== hash) {
    await $.state.set(PENDING_REF, { action, hash })
    return
  }
  await $.state.set(PENDING_REF, null)
  // A reset runs from the mode picked under it, not from a second click on it
  if (action !== 'reset') await run($, action, hash)
}

async function run ($: Engine, action: CommitAction, hash: string, mode: ResetMode = 'mixed') {
  await $.state.set(PENDING_REF, null)
  if (isBusy) return note($, 'error', 'Claude is working: try again when the turn ends')

  const graph = await read($, GRAPH)
  const commit = graph?.commits.find(item => item.hash === hash)
  if (!graph || !commit) return
  const short = hash.slice(0, HASH_WIDTH)

  // A soft or mixed reset keeps the working tree as it is; everything else wants it clean
  if (!(action === 'reset' && mode !== 'hard')) {
    const dirty = (await git($, ['status', '--porcelain']).catch(() => '')).trim()
    if (dirty) return note($, 'error', 'uncommitted changes: commit or stash them first')
  }

  try {
    switch (action) {
      case 'checkout': {
        const target = checkoutCommit(commit, graph.remotes, graph.branches)
        await git($, target.args)
        await note($, 'ok', `checked out ${target.label}`)
        break
      }
      case 'cherry-pick':
        await undoOnConflict($, cmd.cherryPick(hash), cmd.abort('cherry-pick'))
        await note($, 'ok', `cherry-picked ${short} onto ${graph.branch}`)
        break
      case 'revert':
        // A merge is reverted against its first parent, the side it was merged into
        await undoOnConflict($, cmd.revert(hash, commit.parents.length > 1), cmd.abort('revert'))
        await note($, 'ok', `reverted ${short} on ${graph.branch}`)
        break
      case 'merge':
        await undoOnConflict($, cmd.merge(mergeTarget(commit)), cmd.abort('merge'))
        await note($, 'ok', `merged ${mergeTarget(commit)} into ${graph.branch}`)
        break
      case 'rebase':
        await undoOnConflict($, cmd.rebase(hash), cmd.abort('rebase'))
        await note($, 'ok', `rebased ${graph.branch} onto ${short}`)
        break
      case 'reset':
        await git($, cmd.reset(mode, hash))
        await note($, 'ok', `reset ${graph.branch} to ${short} (${mode})`)
        break
    }
  } catch (error) {
    await note($, 'error', (error instanceof Error ? error.message : String(error)).split('\n')[0] ?? '')
  }
  await reload($)
}

/** Runs an action that can stop on a conflict; a conflict is undone, leaving the repo as it was. */
async function undoOnConflict ($: Engine, args: string[], abort: string[]) {
  try {
    await git($, args)
  } catch (error) {
    await git($, abort).catch(() => '')
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(/conflict/i.test(message) ? `${args[0]} stopped on a conflict and was undone: ask Claude to ${args[0]} and resolve it` : message)
  }
}

async function toggleTagging ($: Engine, hash: string) {
  await $.state.set(TAGGING_REF, (await read($, TAGGING)) === hash ? null : hash)
}

/** `name` makes a lightweight tag, `name: message` an annotated one. */
async function tag ($: Engine, hash: string, value: string) {
  const { name, message } = parseTagInput(value)
  if (name === '') return
  try {
    await git($, ['check-ref-format', `refs/tags/${name}`]).catch(() => { throw new Error(`“${name}” is not a valid tag name`) })
    await git($, cmd.tag(name, hash, message))
    await $.state.set(TAGGING_REF, null)
    await note($, 'ok', `tagged ${hash.slice(0, HASH_WIDTH)} as ${name}`)
    await reload($)
  } catch (error) {
    await note($, 'error', (error instanceof Error ? error.message : String(error)).split('\n')[0] ?? '')
  }
}

// ── Branch and tag badges ──────────────────────────────────────────────────────

/** Opens a badge's actions, or closes them when it is the one open. */
async function selectRef ($: Engine, ref: Ref | null) {
  const open = await read($, REF)
  const isSame = open && ref && open.kind === ref.kind && open.name === ref.name
  await $.state.set(REF_REF, isSame ? null : ref)
  await $.state.set(RENAMING_REF, null)
  const pending = await read($, PENDING)
  if (pending && !(pending.action in COMMIT_ACTIONS)) await $.state.set(PENDING_REF, null)
}

const COMMIT_ACTIONS: Record<CommitAction, true> = { checkout: true, 'cherry-pick': true, revert: true, merge: true, rebase: true, reset: true }

function refConfirmText (action: RefAction, ref: Ref, graph: Graph): string {
  const remote = graph.remotes[0] ?? 'origin'
  switch (action) {
    case 'checkout-ref': return ref.kind === 'remote' ? `confirm: checkout ${splitRemote(ref.name, graph.remotes).branch} tracking ${ref.name}?` : `confirm: checkout ${ref.name}?`
    case 'merge-ref': return `confirm: merge ${ref.name} into ${graph.branch}?`
    case 'rebase-ref': return `confirm: rebase ${graph.branch} onto ${ref.name}?`
    case 'delete-branch': return `confirm: delete branch ${ref.name}?`
    case 'force-delete-branch': return `confirm: delete ${ref.name} and its unmerged commits?`
    case 'delete-remote-branch': return `confirm: delete ${ref.name} on the remote?`
    case 'delete-tag': return `confirm: delete tag ${ref.name}?`
    case 'push-ref': return ref.kind === 'tag' ? `confirm: push tag ${ref.name} to ${remote}?` : `confirm: push ${ref.name} to ${remote}?`
  }
}

/** First click arms a badge's action, the second one runs it. */
async function armRef ($: Engine, action: RefAction, ref: Ref) {
  const pending = await read($, PENDING)
  if (!pending || pending.action !== action || pending.hash !== ref.name) {
    await $.state.set(PENDING_REF, { action, hash: ref.name })
    return
  }
  await runRef($, action, ref)
}

async function runRef ($: Engine, action: RefAction, ref: Ref) {
  await $.state.set(PENDING_REF, null)
  if (isBusy) return note($, 'error', 'Claude is working: try again when the turn ends')
  const graph = await read($, GRAPH)
  if (!graph) return
  const remote = graph.remotes[0] ?? 'origin'
  // Deleting a ref or pushing it leaves the working tree alone; the rest want it clean
  if (action === 'checkout-ref' || action === 'merge-ref' || action === 'rebase-ref') {
    const dirty = (await git($, ['status', '--porcelain']).catch(() => '')).trim()
    if (dirty) return note($, 'error', 'uncommitted changes: commit or stash them first')
  }
  try {
    switch (action) {
      case 'checkout-ref':
        if (ref.kind === 'remote') {
          // A local branch of that name already exists: switch to it rather than fail
          await git($, checkoutRemote(ref.name, graph.remotes, graph.branches))
        } else if (ref.kind === 'tag') {
          await git($, cmd.detach(ref.name))
        } else {
          await git($, cmd.switchTo(ref.name))
        }
        await note($, 'ok', `checked out ${ref.name}`)
        break
      case 'merge-ref':
        await undoOnConflict($, cmd.merge(ref.name), cmd.abort('merge'))
        await note($, 'ok', `merged ${ref.name} into ${graph.branch}`)
        break
      case 'rebase-ref':
        await undoOnConflict($, cmd.rebase(ref.name), cmd.abort('rebase'))
        await note($, 'ok', `rebased ${graph.branch} onto ${ref.name}`)
        break
      case 'delete-branch':
        try {
          await git($, cmd.deleteBranch(ref.name, false))
        } catch (error) {
          // Not merged: offer to force it, which loses the commits only that branch has
          if (/not fully merged/i.test(error instanceof Error ? error.message : '')) {
            await $.state.set(PENDING_REF, { action: 'force-delete-branch', hash: ref.name })
            return note($, 'error', `${ref.name} is not fully merged: press again to delete it anyway`)
          }
          throw error
        }
        await note($, 'ok', `deleted branch ${ref.name}`)
        break
      case 'force-delete-branch':
        await git($, cmd.deleteBranch(ref.name, true))
        await note($, 'ok', `deleted branch ${ref.name}`)
        break
      case 'delete-remote-branch': {
        const target = splitRemote(ref.name, graph.remotes)
        await git($, cmd.deleteRemoteBranch(target.remote, target.branch), [0], 120000)
        await note($, 'ok', `deleted ${target.branch} on ${target.remote}`)
        break
      }
      case 'delete-tag':
        await git($, cmd.deleteTag(ref.name))
        await note($, 'ok', `deleted tag ${ref.name}`)
        break
      case 'push-ref':
        await git($, ref.kind === 'tag' ? cmd.pushTag(remote, ref.name) : cmd.pushBranch(remote, ref.name), [0], 120000)
        await note($, 'ok', `pushed ${ref.name} to ${remote}`)
        break
    }
  } catch (error) {
    await note($, 'error', (error instanceof Error ? error.message : String(error)).split('\n')[0] ?? '')
  }
  await reload($)
}

/** Every remote's branches and tags; branches deleted on a remote go here too. */
async function fetchAll ($: Engine) {
  await note($, 'info', 'fetching…')
  try {
    await git($, cmd.fetchAll(), [0], 300000)
    await note($, 'ok', 'fetched every remote')
  } catch (error) {
    await note($, 'error', (error instanceof Error ? error.message : String(error)).split('\n')[0] ?? '')
  }
  await reload($)
}

/** Pull and fetch change nothing local but the branch they update: they run on one click. */
async function pullRef ($: Engine, ref: Ref) {
  if (isBusy) return note($, 'error', 'Claude is working: try again when the turn ends')
  try {
    if (ref.kind === 'remote') {
      const graph = await read($, GRAPH)
      const target = splitRemote(ref.name, graph?.remotes ?? [])
      await git($, cmd.fetchBranch(target.remote, target.branch), [0], 120000)
      await note($, 'ok', `fetched ${ref.name}`)
    } else {
      // Only fast-forwards: a pull that would merge is Claude's to resolve. A branch not checked
      // out is fetched into, which moves it to its upstream without touching the working tree
      const graph = await read($, GRAPH)
      const upstream = graph?.upstreams[ref.name]
      if (!upstream) return note($, 'error', `${ref.name} has no upstream to pull from: push it first`)
      await git($, ref.kind === 'head' ? cmd.pullCurrent() : cmd.pullOther(ref.name, upstream.name, graph.remotes), [0], 120000)
      await note($, 'ok', `${ref.name} is at ${upstream.name}`)
    }
  } catch (error) {
    await note($, 'error', (error instanceof Error ? error.message : String(error)).split('\n')[0] ?? '')
  }
  await reload($)
}

async function renameBranch ($: Engine, from: string, value: string) {
  const to = value.trim()
  if (to === '' || to === from) return $.state.set(RENAMING_REF, null)
  try {
    await git($, cmd.renameBranch(from, to))
    await $.state.set(RENAMING_REF, null)
    await $.state.set(REF_REF, null)
    await note($, 'ok', `renamed ${from} to ${to}`)
  } catch (error) {
    await note($, 'error', (error instanceof Error ? error.message : String(error)).split('\n')[0] ?? '')
  }
  await reload($)
}

// ── Stashes ────────────────────────────────────────────────────────────────────

async function toggleStashing ($: Engine, target: string) {
  await $.state.set(STASHING_REF, (await read($, STASHING)) === target ? null : target)
}

/** Stashes the uncommitted changes, untracked files included, with the message given, if any. */
async function stashChanges ($: Engine, message: string) {
  if (isBusy) return note($, 'error', 'Claude is working: try again when the turn ends')
  try {
    await git($, cmd.stashPush(message))
    await $.state.set(STASHING_REF, null)
    await clearSelection($)
    await note($, 'ok', 'stashed the uncommitted changes')
  } catch (error) {
    await note($, 'error', (error instanceof Error ? error.message : String(error)).split('\n')[0] ?? '')
  }
  await reload($)
}

/** Apply keeps the stash and runs on one click; pop and drop lose it, so they ask first. */
async function stashAction ($: Engine, action: 'stash-apply' | StashAction, stash: Commit) {
  if (action !== 'stash-apply') {
    const pending = await read($, PENDING)
    if (!pending || pending.action !== action || pending.hash !== stash.hash) {
      await $.state.set(PENDING_REF, { action, hash: stash.hash })
      return
    }
  }
  await $.state.set(PENDING_REF, null)
  if (isBusy) return note($, 'error', 'Claude is working: try again when the turn ends')
  const name = stash.stash ?? 'stash@{0}'
  const verb = action.slice(6) as 'apply' | 'pop' | 'drop'
  try {
    await git($, cmd.stash(verb, name))
    await note($, 'ok', `${verb === 'drop' ? 'dropped' : verb === 'pop' ? 'popped' : 'applied'} ${name}`)
    if (verb !== 'apply') await clearSelection($)
  } catch (error) {
    await note($, 'error', (error instanceof Error ? error.message : String(error)).split('\n')[0] ?? '')
  }
  await reload($)
}

/** A new branch at the commit the stash was made on, with the stash applied and dropped. */
async function branchFromStash ($: Engine, stash: Commit, value: string) {
  const name = value.trim()
  if (name === '') return
  try {
    await git($, cmd.stashBranch(name, stash.stash ?? 'stash@{0}'))
    await clearSelection($)
    await note($, 'ok', `made branch ${name} from ${stash.stash}`)
  } catch (error) {
    await note($, 'error', (error instanceof Error ? error.message : String(error)).split('\n')[0] ?? '')
  }
  await reload($)
}

/** Writing the message is Claude's job: it proposes one and asks before committing. */
async function commitChanges ($: Engine) {
  await ask($, 'Commit the current uncommitted changes. Look at the diff, propose a commit message and ask me before committing.', 'asked Claude to commit the changes')
}

async function ask ($: Engine, text: string, done: string) {
  if (isBusy) return note($, 'error', 'Claude is working: try again when the turn ends')
  try {
    const result = await $.prompt.submit({ text, asUser: true })
    if (result?.drop) await note($, 'error', String(result.drop))
    else await note($, 'info', done)
  } catch (error) {
    await note($, 'error', error instanceof Error ? error.message : String(error))
  }
}

/** Naming a branch needs a conversation: Claude asks, and its own permissions apply. */
async function newBranch ($: Engine, commit: Commit) {
  const short = commit.hash.slice(0, HASH_WIDTH)
  await ask($, `Create a new git branch from commit ${short} ("${commit.subject}"). Ask me for the branch name first, and whether to switch to it.`, `asked Claude for a branch from ${short}`)
}

// ── Drawing ────────────────────────────────────────────────────────────────────

function cut (text: string, width: number) {
  return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`
}

/**
 * The surface's elements, with the ones it does not draw left out, so a drawing can ask for them:
 * the terminal has no Svg, mobile no Input or Select.
 */
function elementsOf ($: Engine, e: RenderOf<'Pane'>): Ui {
  const table: Ui = $.ui.resolve(e)
  return {
    Box: table.Box,
    Text: table.Text,
    Button: table.Button,
    Link: table.Link,
    Code: table.Code,
    Markdown: table.Markdown,
    Input: e.surface === 'mobile' ? undefined : table.Input,
    Select: e.surface === 'mobile' ? undefined : table.Select,
    Svg: e.surface === 'terminal' ? undefined : table.Svg
  }
}

async function drawPane ($: Engine, e: RenderOf<'Pane'>) {
  const ui = elementsOf($, e)
  const { Box, Button, Input, Select, Text } = ui
  const graph = await read($, GRAPH)
  const selected = await read($, SELECTED)
  const detail = await read($, DETAIL)
  const diff = await read($, DIFF)
  const allBranches = await read($, ALL)
  const filter = await read($, FILTER)
  const repo = await read($, REPO)
  await read($, PICKER_REDRAW)
  const compact = await read($, COMPACT)
  const settingsOpen = await read($, SETTINGS)
  const muteMerges = await read($, MUTE_MERGES)
  // Only a surface that draws SVG gets curves
  const curves = Boolean(ui.Svg) && (await read($, CURVES))
  const avatars = await read($, AVATARS)
  const showAuthor = await read($, SHOW_AUTHOR)
  const showDate = await read($, SHOW_DATE)
  const dateFormat = await read($, DATE_FORMAT)
  const muteOthers = await read($, MUTE_OTHERS)
  const pending = await read($, PENDING)
  const tagging = await read($, TAGGING)
  const stashing = await read($, STASHING)
  const compareBase = await read($, COMPARE)
  const openRef = await read($, REF)
  const renaming = await read($, RENAMING)
  const lastNote = await read($, NOTE)
  const pageStart = await read($, PAGE_START)
  const columns = Math.max(40, e.props.bodyColumns)
  const count = graph?.commits.filter(commit => !commit.kind).length ?? 0
  const typed = await read($, QUERY)
  const query = typed.trim()
  const found = query === '' ? graph?.commits ?? [] : (graph?.commits ?? []).filter(commit => matches(commit, query))
  const matching = found.length

  const isDrawn = graph !== null && !graph.error
  const header = (
    <Box key="header" flexDirection="column">
      {Select && graph && graph.repos.length > 1 && (
        <Select
          key="repo"
          label="repo "
          value={repo ?? graph.repos[0]?.path}
          options={graph.repos.map(item => ({ value: item.path, label: item.label }))}
          onSelect={(value: string) => pickRepo($, value)}
        />
      )}
      {/* Where the repo stands on the left, what changes the view on the right; a narrow pane wraps the two */}
      <Box flexDirection="row" justifyContent="space-between" flexWrap="wrap" columnGap={2}>
        {/* Where the repo stands: text alone, so no hotkey chip sits among it */}
        <Box flexDirection="row" columnGap={2} alignItems="center" flexShrink={1}>
          <Text color="green" bold wrap="truncate-end">{graph?.branch ? `⎇ ${graph.branch}` : 'Git Graph'}</Text>
          {graph && graph.changes.length > 0 && <Text color="yellow">{`● ${graph.changes.length} uncommitted`}</Text>}
          {isDrawn && <Text dimColor>{`${count} commits${count >= limit ? ` (last ${limit})` : ''}`}</Text>}
        </Box>
        <Box flexDirection="row" columnGap={2} alignItems="center" flexShrink={0}>
          {Select && graph && graph.branches.length > 0
            ? (
              <Select
                key="branches"
                value={filter !== null ? `ref:${filter}` : allBranches ? 'all' : 'current'}
                options={[
                  { value: 'all', label: 'all branches' },
                  { value: 'current', label: 'current branch' },
                  ...(graph.localCount > 0 ? [{ value: 'sep:local', label: '── local ──' }] : []),
                  ...graph.branches.slice(0, graph.localCount).map(name => ({ value: `ref:${name}`, label: name })),
                  ...(graph.branches.length > graph.localCount ? [{ value: 'sep:remote', label: '── remote ──' }] : []),
                  ...graph.branches.slice(graph.localCount).map(name => ({ value: `ref:${name}`, label: name }))
                ]}
                onSelect={(value: string) => pickBranches($, value)}
              />
              )
            : <Button key="branches" label={allBranches ? 'all branches' : 'current branch'} plain dimColor onPress={() => toggleAll($)} />}
          {graph && graph.remotes.length > 0 && <Button key="fetch" label="⇣ fetch" hotkey="f" plain dimColor onPress={() => fetchAll($)} />}
          <Button key="reload" label="↻" hotkey="r" plain dimColor onPress={() => reload($)} />
          <Button key="settings" label={settingsOpen ? '⚙ settings ▾' : '⚙ settings'} plain dimColor={!settingsOpen} onPress={() => toggleSettings($)} />
        </Box>
      </Box>
      {/* Finding on the left, walking the rows on the right. The walk's buttons are drawn here,
          always, because a Button's hotkey only answers while the Button is drawn */}
      {isDrawn && (
        <Box flexDirection="row" justifyContent="space-between" flexWrap="wrap" columnGap={2} marginTop={1}>
          <Box flexDirection="row" columnGap={1} alignItems="center" flexGrow={1} flexShrink={1}>
            {Input && <Button key="focus-find" label="⌕" hotkey="s" plain dimColor onPress={() => focusFind($)} />}
            {Input && (
              <Box flexGrow={1}>
                <Input key="find" placeholder="find a message, author, hash or branch" value={typed} submitLabel="find" onInput={(value: string) => find($, value)} onSubmit={(value: string) => find($, value)} />
              </Box>
            )}
            {query !== '' && <Text dimColor>{`${matching} ${matching === 1 ? 'match' : 'matches'}`}</Text>}
            {query !== '' && <Button key="find-clear" label="✕ clear" plain dimColor onPress={() => find($, '')} />}
          </Box>
          <Box flexDirection="row" columnGap={2} alignItems="center" flexShrink={0}>
            <Button key="previous" label="↑" hotkey="k" plain dimColor onPress={() => step($, -1)} />
            <Button key="next" label="↓" hotkey="j" plain dimColor onPress={() => step($, 1)} />
            <Button key="head" label="HEAD" hotkey="h" plain dimColor onPress={() => goHead($)} />
          </Box>
        </Box>
      )}
      {settingsOpen && drawSettings(ui, $, { compact, curves, avatars, showAuthor, showDate, dateFormat, muteMerges, muteOthers, canFetch: Boolean(graph && graph.remotes.length > 0) })}
      {compareBase !== null && (
        <Box flexDirection="row" columnGap={2}>
          <Text wrap="truncate-end"><Text color="cyan">{`⇄ comparing with ${compareBase === WORKTREE ? 'the working tree' : compareBase.slice(0, HASH_WIDTH)}`}</Text><Text dimColor>  · open another commit</Text></Text>
          <Button key="compare-stop" label="✕ stop comparing" plain dimColor onPress={() => stopComparing($)} />
        </Box>
      )}
      {lastNote && <Text color={NOTE_COLOR[lastNote.kind]} wrap="truncate-end">{lastNote.text}</Text>}
    </Box>
  )

  if (!graph) return <Box flexDirection="column">{header}<Text dimColor>Loading…</Text></Box>
  if (graph.error) return <Box flexDirection="column">{header}<Text color="red">{graph.error}</Text></Box>
  if (graph.commits.length === 0) return <Box flexDirection="column">{header}<Text dimColor>No commits yet.</Text></Box>

  if (query !== '' && found.length === 0) return <Box flexDirection="column">{header}<Text> </Text><Text dimColor>{`No commit in the last ${count} matches “${query}”.`}</Text></Box>

  // The page drawn, kept inside the rows found when they shrink under it
  const start = Math.min(pageStart, Math.max(0, Math.floor((found.length - 1) / PAGE) * PAGE))
  const visible = found.slice(start, start + PAGE)
  const end = start + visible.length
  // Compact drops the gap after every lane: half as wide, the junction glyphs still connect
  const cellsOf = (commit: Commit) => {
    // Found commits are not neighbours: their lanes would not connect, so each keeps its dot alone
    if (query !== '') return [{ ch: '●', lane: commit.cells.find(cell => cell.ch === '●')?.lane ?? 0 }]
    const cells = compact ? commit.cells.filter((_, i) => i % 2 === 0) : commit.cells
    // The uncommitted row is hollow: nothing is committed there yet
    const node = commit.kind === 'worktree' ? '○' : commit.kind === 'stash' ? '◈' : '●'
    return node === '●' ? cells : cells.map(cell => (cell.ch === '●' ? { ...cell, ch: node } : cell))
  }
  const graphWidth = Math.max(...visible.map(commit => cellsOf(commit).length)) + 1
  const metaWidth = (showAuthor ? AUTHOR_WIDTH + 1 + (avatars ? AVATAR_WIDTH : 0) : 0) + (showDate ? DATE_WIDTH + 1 : 0)
  const showMeta = metaWidth > 0 && columns >= graphWidth + metaWidth + HASH_WIDTH + 30
  const textWidth = columns - graphWidth - HASH_WIDTH - 3 - (showMeta ? metaWidth + 1 : 0)

  // Dim, as the settings say: merges, and commits that are no ancestor of HEAD
  const reached = muteOthers ? ancestorsOf(graph.commits, graph.head) : null
  const isMuted = (commit: Commit) => query === '' && !commit.kind &&
    ((muteMerges && commit.parents.length > 1) || (reached !== null && !reached.has(commit.hash)))

  const rows = []
  for (const commit of visible) {
    const isSelected = commit.hash === selected
    const cells = cellsOf(commit)
    const isCurved = curves && query === ''
    rows.push(drawRow(ui, $, commit, cells, { curves: isCurved, avatars, showAuthor, showDate, graphWidth, textWidth, showMeta, isSelected, query, openRef, isMuted: isMuted(commit) }))
    const badge = openRef && commit.refs.find(ref => ref.kind === openRef.kind && ref.name === openRef.name)
    // A panel opened under a row keeps the lanes going beside it, down to the next commit
    const underRow = query === '' ? cells : []
    if (badge) rows.push(drawBeside(ui, `refs-${badge.kind}-${badge.name}`, underRow, isCurved, graphWidth, drawRefActions(ui, $, badge, pending, renaming === badge.name, graph)))
    if (isSelected) rows.push(drawBeside(ui, `detail-${commit.hash}`, underRow, isCurved, graphWidth, drawDetail(ui, $, commit, detail?.hash === commit.hash ? detail : null, diff, pending, { isTagging: tagging === commit.hash, isStashing: stashing === commit.hash, compareBase }, graph)))
  }

  return (
    <Box flexDirection="column">
      {header}
      <Text> </Text>
      {start > 0 && <Button key="newer" label={`▴ newer ${Math.min(PAGE, start)}`} plain dimColor onPress={() => $.state.set(PAGE_START_REF, Math.max(0, start - PAGE))} />}
      {rows}
      {found.length > PAGE && (
        <Box key="pages" flexDirection="row" columnGap={2}>
          {end < found.length && <Button key="older" label={`older ${Math.min(PAGE, found.length - end)} ▾`} plain dimColor onPress={() => $.state.set(PAGE_START_REF, end)} />}
          <Text dimColor>{`${start + 1}–${end} of ${found.length}`}</Text>
        </Box>
      )}
    </Box>
  )
}

/**
 * The settings, as a panel under the header: a line per group, its name in a dim column of its
 * own. Keys is a reference only: the Buttons the keys press stay in the header, drawn always.
 */
function drawSettings (
  ui: Ui, $: Engine,
  { compact, curves, avatars, showAuthor, showDate, dateFormat, muteMerges, muteOthers, canFetch }: { compact: boolean; curves: boolean; avatars: boolean; showAuthor: boolean; showDate: boolean; dateFormat: DateFormat; muteMerges: boolean; muteOthers: boolean; canFetch: boolean }
) {
  const { Box, Button, Text } = ui
  const check = (isOn: boolean, label: string) => `${isOn ? '☑' : '☐'} ${label}`
  const keys = ['j next', 'k previous', 'h HEAD', ...(ui.Input ? ['s find'] : []), ...(canFetch ? ['f fetch'] : []), 'r reload', 'esc close']
  return (
    <Box key="settings-panel" flexDirection="column" marginTop={1} borderStyle="round" borderColor="gray" paddingX={1}>
      {drawSetting(ui, 'lanes', 'Lanes', [
        <Button key="compact" label={compact ? 'compact' : 'spaced'} plain onPress={() => toggleCompact($)} />,
        ui.Svg && <Button key="curves" label={curves ? 'curves' : 'glyphs'} plain onPress={() => toggleCurves($)} />
      ])}
      {drawSetting(ui, 'columns', 'Columns', [
        <Button key="show-author" label={check(showAuthor, 'author')} plain onPress={() => toggleShowAuthor($)} />,
        <Button key="avatars" label={check(avatars, 'avatars')} plain onPress={() => toggleAvatars($)} />,
        <Button key="show-date" label={check(showDate, 'date')} plain onPress={() => toggleShowDate($)} />,
        <Button key="date-format" label={`date: ${dateFormat}`} plain onPress={() => cycleDateFormat($)} />
      ])}
      {drawSetting(ui, 'dim', 'Dim', [
        <Button key="mute-merges" label={check(muteMerges, 'merge commits')} plain onPress={() => toggleMuteMerges($)} />,
        <Button key="mute-others" label={check(muteOthers, 'commits HEAD does not reach')} plain onPress={() => toggleMuteOthers($)} />
      ])}
      {drawSetting(ui, 'keys', 'Keys', [<Text key="keys-help" dimColor>{keys.join(' · ')}</Text>])}
    </Box>
  )
}

/** One group of the settings: its name, then its controls. The Box key is prefixed, so it never meets a Button's. */
function drawSetting (ui: Ui, key: string, label: string, controls: unknown[]) {
  const { Box, Text } = ui
  return (
    <Box key={`setting-${key}`} flexDirection="row" columnGap={1}>
      <Box width={SETTING_LABEL_WIDTH} flexShrink={0}><Text dimColor>{label}</Text></Box>
      <Box flexDirection="row" columnGap={2} flexWrap="wrap" flexShrink={1}>{controls.filter(Boolean)}</Box>
    </Box>
  )
}

/** Initials on the author's color: a round SVG where the surface draws one, colored letters elsewhere. */
function drawAvatar (ui: Ui, author: string) {
  const { Box, Svg, Text } = ui
  if (Svg) {
    return (
      <Box width={AVATAR_WIDTH} flexShrink={0} height={1}>
        <Svg source={avatarOf(author, 15)} alt={initialsOf(author)} width={15} height={15} />
      </Box>
    )
  }
  return <Box width={AVATAR_WIDTH} flexShrink={0}><Text color={LANE_COLORS[colorIndexOf(author, LANE_COLORS.length)]} bold>{initialsOf(author)}</Text></Box>
}

/** A text with the part that matches the find field lit. */
function drawLit (Text: any, text: string, query: string, style: Record<string, boolean>) {
  const [before, lit, after] = splitMatch(text, query)
  if (lit === '') return <Text {...style}>{text}</Text>
  return <Text {...style}>{before}<Text color="yellow" bold underline>{lit}</Text>{after}</Text>
}

/** One graph cell, in a box one column wide so every row lines up in a proportional font. */
function drawCell (Box: any, Text: any, cell: Cell, key: number) {
  const color = LANE_COLORS[cell.lane % LANE_COLORS.length]
  const ch = glyphOf(cell)
  // A horizontal line is drawn longer than its box and clipped: in a proportional font a
  // single ─ is narrower than the column, which left gaps in the merge lines
  if (ch === '─') {
    return <Box key={key} width={1} flexShrink={0} overflow="hidden"><Text color={color} wrap="truncate">{'────'}</Text></Box>
  }
  if (cell.across !== undefined) {
    // A line passes through: drawn behind, full width, in its own lane's color
    const across = LANE_COLORS[cell.across % LANE_COLORS.length]
    return (
      <Box key={key} width={1} flexShrink={0} overflow="hidden">
        <Box position="absolute" top={0} left={0}><Text color={across} wrap="truncate">{'────'}</Text></Box>
        <Text color={color}>{ch === '┼' ? '│' : ch}</Text>
      </Box>
    )
  }
  return <Box key={key} width={1} flexShrink={0}><Text color={color}>{ch}</Text></Box>
}

function drawRow (
  ui: Ui, $: Engine, commit: Commit, cells: Commit['cells'],
  { curves, avatars, showAuthor, showDate, graphWidth, textWidth, showMeta, isSelected, query, openRef, isMuted }: { curves: boolean; avatars: boolean; showAuthor: boolean; showDate: boolean; graphWidth: number; textWidth: number; showMeta: boolean; isSelected: boolean; query: string; openRef: Ref | null; isMuted: boolean }
) {
  const { Box, Button, Svg, Text } = ui
  // The text is cut to one line by hand: a narrow pane would otherwise wrap it.
  // Narrow panes also shorten long branch names, so the subject keeps some room.
  let room = Math.max(10, textWidth)
  const maxRef = textWidth < 70 ? 22 : 60
  const refs = commit.refs.map(ref => {
    const badge = `[${cut(ref.kind === 'tag' ? `◆ ${ref.name}` : ref.name, maxRef)}]`
    const text = badge.length + 1 <= room ? badge : ''
    room -= text.length + (text ? 1 : 0)
    return { ref, text }
  }).filter(item => item.text)

  return (
    <Box key={commit.hash} flexDirection="row">
      {curves
        ? (
          // Built like an avatar, which desktop draws: a box with no clipping, and an alt that says
          // something (an SVG with an empty alt was left out of the pane)
          <Box width={graphWidth} height={1} flexShrink={0}>
            <Svg source={curvesOf(cells)} alt={LANES_ALT} width={Math.max(1, cells.length) * CURVE_CELL.width} height={CURVE_CELL.height} />
          </Box>
          )
        : (
          <Box width={graphWidth} flexShrink={0} flexDirection="row">
            {cells.map((cell, i) => drawCell(Box, Text, cell, i))}
          </Box>
          )}
      <Box flexGrow={1} flexShrink={1} height={1} overflow="hidden" flexDirection="row">
        {refs.map(({ ref, text }) => {
          const isOpen = openRef?.kind === ref.kind && openRef.name === ref.name
          // A badge is a button: its actions open under the row
          return (
            <Button key={`ref-${ref.kind}-${ref.name}`} plain onPress={() => selectRef($, ref)}>
              <Text color={REF_COLOR[ref.kind]} bold={ref.kind === 'head' || isOpen} underline={isOpen}>{text}</Text>{' '}
            </Button>
          )
        })}
        {commit.stash && <Text color="cyan">{`[${commit.stash}] `}</Text>}
        <Text wrap="truncate-end">
          {drawLit(Text, cut(commit.subject, room - (commit.stash ? commit.stash.length + 3 : 0)), query, { dimColor: (isMuted || commit.kind === 'worktree') && !isSelected && query === '', italic: commit.kind === 'worktree', bold: isSelected })}
        </Text>
      </Box>
      {showMeta && showAuthor && (
        <Box width={AUTHOR_WIDTH + 1 + (avatars ? AVATAR_WIDTH : 0)} flexShrink={0} marginLeft={1} flexDirection="row">
          {avatars && commit.author !== '' && drawAvatar(ui, commit.author)}
          <Text dimColor wrap="truncate-end">{drawLit(Text, commit.author, query, {})}</Text>
        </Box>
      )}
      {showMeta && showDate && (
        <Box width={DATE_WIDTH + 1} flexShrink={0} marginLeft={showAuthor ? 0 : 1}>
          <Text dimColor wrap="truncate-end">{commit.date}</Text>
        </Box>
      )}
      <Box width={HASH_WIDTH + 2} flexShrink={0} justifyContent="flex-end">
        <Button key={`hash-${commit.hash}`} label={commit.kind === 'worktree' ? '*' : commit.hash.slice(0, HASH_WIDTH)} plain dimColor={!isSelected} onPress={() => select($, commit.hash)} />
      </Box>
    </Box>
  )
}

/**
 * A panel under a row, with the lanes that go on below the row drawn down its left side. The
 * lanes stand apart from the layout and are clipped to the panel's height, whatever it comes to.
 */
function drawBeside (ui: Ui, key: string, cells: Cell[], curves: boolean, graphWidth: number, panel: unknown) {
  const { Box, Svg, Text } = ui
  return (
    <Box key={`beside-${key}`} flexDirection="row">
      <Box width={graphWidth} flexShrink={0} />
      <Box position="absolute" top={0} left={0} width={graphWidth} height="100%" overflow="hidden">
        {curves
          ? <Svg source={linesDownOf(cells, PANEL_ROWS)} alt={LANES_ALT} width={Math.max(1, cells.length) * CURVE_CELL.width} height={PANEL_ROWS * CURVE_CELL.height} />
          : (
            <Box flexDirection="row">
              {cells.map((cell, i) => (
                <Box key={i} width={1} flexShrink={0}>
                  <Text color={LANE_COLORS[cell.lane % LANE_COLORS.length]}>{goesDown(cell) ? LANE_DOWN : ' '}</Text>
                </Box>
              ))}
            </Box>
            )}
      </Box>
      <Box flexGrow={1} flexShrink={1} flexDirection="column">{panel}</Box>
    </Box>
  )
}

/** The open commit, under its own row: actions, then its message and files. */
function drawDetail (
  ui: Ui, $: Engine, commit: Commit, detail: Detail, diff: Diff,
  pending: Pending | null, fields: { isTagging: boolean; isStashing: boolean; compareBase: string | null }, graph: Graph
) {
  const { Box, Text } = ui
  const isBase = fields.compareBase === commit.hash
  const compare = action(ui, 'compare', isBase ? '⇄ Unmark' : fields.compareBase ? '⇄ Compare with this' : '⇄ Compare', () => toggleCompare($, commit.hash), isBase)
  const isWorktree = commit.kind === 'worktree'
  const panel = isWorktree
    ? drawWorktreeActions(ui, $, fields.isStashing, compare)
    : commit.kind === 'stash'
      ? drawStashActions(ui, $, commit, pending, fields.isStashing, compare)
      : drawCommitActions(ui, $, commit, pending, fields.isTagging, graph, compare)

  return (
    <Box key={`detail-${commit.hash}`} flexDirection="column" marginTop={1} marginBottom={1} borderStyle="round" borderColor="gray" paddingX={1}>
      {panel}
      <Text> </Text>
      {!detail || detail.isLoading
        ? <Text dimColor>Loading…</Text>
        : drawDetailBody(ui, $, detail, diff, graph)}
    </Box>
  )
}

/** A panel's first line: its title on the left, quick links (copy, the web page) on the right. */
function drawPanelTitle (ui: Ui, title: string, subtitle: string, color: string, quick: unknown[]) {
  const { Box, Text } = ui
  return (
    <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
      <Box flexShrink={1}>
        <Text wrap="truncate-end"><Text color={color} bold>{title}</Text><Text dimColor>{subtitle ? `  ${subtitle}` : ''}</Text></Text>
      </Box>
      <Box flexDirection="row" columnGap={2} flexShrink={0}>{quick.filter(Boolean)}</Box>
    </Box>
  )
}

/**
 * A row of action buttons in groups, a dim bar between groups: what looks around, what changes
 * the current branch, what deletes. Native buttons on desktop, bracketed in the terminal.
 */
function drawToolbar (ui: Ui, groups: unknown[][]) {
  const { Box, Text } = ui
  const shown = groups.map(group => group.filter(Boolean)).filter(group => group.length > 0)
  return (
    <Box flexDirection="row" columnGap={1} flexWrap="wrap" alignItems="center" marginTop={1}>
      {shown.flatMap((group, i) => [...(i > 0 ? [<Text key={`bar-${i}`} dimColor>│</Text>] : []), ...group])}
    </Box>
  )
}

/** One action button; while it waits for its confirming press it is the primary one, saying what it will do. */
function action (ui: Ui, key: string, label: string, onPress: () => unknown, isArmed = false) {
  const { Button } = ui
  return <Button key={key} label={label} variant={isArmed ? 'primary' : undefined} onPress={onPress} />
}

/** A small link-like button for the panel's title line. */
function quickButton (ui: Ui, key: string, label: string, onPress: () => unknown) {
  const { Button } = ui
  return <Button key={key} label={label} plain dimColor onPress={onPress} />
}

function drawWorktreeActions (ui: Ui, $: Engine, isStashing: boolean, compare: unknown) {
  const { Box, Input } = ui
  return (
    <Box flexDirection="column">
      {drawPanelTitle(ui, 'Uncommitted Changes', 'in the working tree', 'yellow', [])}
      {drawToolbar(ui, [
        [action(ui, 'commit', '✎ Commit…', () => commitChanges($)), Input && action(ui, 'stash', '⊟ Stash…', () => toggleStashing($, WORKTREE), isStashing)],
        [compare]
      ])}
      {isStashing && Input && (
        <Input key="stash-message" label="⊟ " placeholder="a message for the stash, or none" submitLabel="stash" autoFocus onSubmit={(value: string) => stashChanges($, value)} />
      )}
    </Box>
  )
}

function drawStashActions (ui: Ui, $: Engine, stash: Commit, pending: Pending | null, isBranching: boolean, compare: unknown) {
  const { Box, Input } = ui
  const armed = (item: StashAction) => pending?.action === item && pending.hash === stash.hash
  return (
    <Box flexDirection="column">
      {drawPanelTitle(ui, stash.stash ?? 'stash', stash.hash.slice(0, HASH_WIDTH), 'cyan', [
        quickButton(ui, 'copy', '⧉ hash', () => copyText($, stash.hash, stash.hash.slice(0, HASH_WIDTH)))
      ])}
      {drawToolbar(ui, [
        [
          action(ui, 'stash-apply', '⇣ Apply', () => stashAction($, 'stash-apply', stash)),
          action(ui, 'stash-pop', armed('stash-pop') ? `Apply and drop ${stash.stash}?` : '⇣ Pop', () => stashAction($, 'stash-pop', stash), armed('stash-pop')),
          Input && action(ui, 'stash-branch', '+ Branch…', () => toggleStashing($, stash.hash), isBranching)
        ],
        [compare],
        [action(ui, 'stash-drop', armed('stash-drop') ? `confirm: drop ${stash.stash}?` : '✕ Drop', () => stashAction($, 'stash-drop', stash), armed('stash-drop'))]
      ])}
      {isBranching && Input && (
        <Input key="stash-branch-name" label="+ " placeholder="a name for the new branch" submitLabel="branch" autoFocus onSubmit={(value: string) => branchFromStash($, stash, value)} />
      )}
    </Box>
  )
}

function drawCommitActions (ui: Ui, $: Engine, commit: Commit, pending: Pending | null, isTagging: boolean, graph: Graph, compare: unknown) {
  const { Box, Input, Link, Text } = ui
  const isHead = commit.refs.some(ref => ref.kind === 'head')
  const armed = (item: CommitAction) => pending?.action === item && pending.hash === commit.hash
  /** A button that asks for a second press before it changes the repo. */
  const guarded = (item: CommitAction, label: string) => action(ui, item, armed(item) ? confirmText(item, commit, graph) : label, () => arm($, item, commit.hash), armed(item))
  const page = commitUrl(graph.forge, commit.hash)

  return (
    <Box flexDirection="column">
      {drawPanelTitle(ui, `Commit ${commit.hash.slice(0, HASH_WIDTH)}`, isHead ? `HEAD · ${graph.branch}` : '', 'yellow', [
        quickButton(ui, 'copy', '⧉ hash', () => copyText($, commit.hash, commit.hash.slice(0, HASH_WIDTH))),
        quickButton(ui, 'copy-subject', '⧉ subject', () => copyText($, commit.subject, 'the subject')),
        page && <Link key="web" href={page} label={`↗ ${graph.forge?.host}`} />
      ])}
      {drawToolbar(ui, [
        [
          !isHead && guarded('checkout', '⎇ Checkout'),
          action(ui, 'branch', '+ Branch…', () => newBranch($, commit)),
          action(ui, 'tag', '◆ Tag…', () => toggleTagging($, commit.hash), isTagging),
          compare
        ],
        [
          !isHead && commit.parents.length === 1 && guarded('cherry-pick', '⇣ Cherry-pick'),
          guarded('revert', '↶ Revert'),
          !isHead && guarded('merge', '⤞ Merge into current'),
          !isHead && guarded('rebase', '⇡ Rebase current onto'),
          !isHead && guarded('reset', '↺ Reset current to')
        ]
      ])}
      {armed('reset') && (
        <Box flexDirection="row" columnGap={1} flexWrap="wrap" alignItems="center" marginTop={1}>
          <Text color="yellow">{confirmText('reset', commit, graph)}</Text>
          {action(ui, 'reset-soft', 'Soft · keep changes staged', () => run($, 'reset', commit.hash, 'soft'))}
          {action(ui, 'reset-mixed', 'Mixed · keep them unstaged', () => run($, 'reset', commit.hash, 'mixed'))}
          {action(ui, 'reset-hard', 'Hard · discard them', () => run($, 'reset', commit.hash, 'hard'))}
          {quickButton(ui, 'reset-cancel', 'cancel', () => $.state.set(PENDING_REF, null))}
        </Box>
      )}
      {isTagging && Input && (
        <Input key="tag-name" label="◆ " placeholder="v1.2  or  v1.2: message for an annotated tag" submitLabel="tag" autoFocus onSubmit={(value: string) => tag($, commit.hash, value)} />
      )}
    </Box>
  )
}

/** A badge's actions, under its row: what fits its kind, and whether it is checked out. */
function drawRefActions (ui: Ui, $: Engine, ref: Ref, pending: Pending | null, isRenaming: boolean, graph: Graph) {
  const { Box, Input, Link, Text } = ui
  const isCurrent = ref.kind === 'head'
  const branchName = ref.kind === 'remote' ? splitRemote(ref.name, graph.remotes).branch : ref.name
  const pullRequest = ref.kind !== 'tag' && ref.name !== 'HEAD' ? pullRequestUrl(graph.forge, branchName, graph.defaultBranch) : null
  const isBranch = (ref.kind === 'head' && ref.name !== 'HEAD') || ref.kind === 'local'
  const armed = (item: RefAction) => pending?.action === item && pending.hash === ref.name
  const guarded = (item: RefAction, label: string) => action(ui, item, armed(item) ? refConfirmText(item, ref, graph) : label, () => armRef($, item, ref), armed(item))
  const hasRemote = graph.remotes.length > 0
  // How the branch stands against its upstream: what a push and a pull would move
  const upstream = isBranch ? graph.upstreams[ref.name] : undefined
  const kind = ref.kind === 'tag' ? '◆ Tag' : ref.kind === 'remote' ? 'Remote branch' : isCurrent ? 'Current branch' : 'Branch'

  return (
    <Box key={`refs-${ref.kind}-${ref.name}`} flexDirection="column" marginBottom={1} borderStyle="round" borderColor={REF_COLOR[ref.kind]} paddingX={1}>
      {drawPanelTitle(ui, `${kind} ${ref.name}`, '', REF_COLOR[ref.kind], [
        quickButton(ui, 'copy-name', '⧉ name', () => copyText($, ref.name, ref.name)),
        pullRequest && <Link key="pull-request" href={pullRequest} label={`↗ pull request into ${graph.defaultBranch}`} />
      ])}
      {upstream && <Text color={upstream.behind > 0 || upstream.isGone ? 'yellow' : 'gray'} wrap="truncate-end">{describeUpstream(upstream)}</Text>}
      {drawToolbar(ui, [
        [
          !isCurrent && guarded('checkout-ref', '⎇ Checkout'),
          !isCurrent && guarded('merge-ref', '⤞ Merge into current'),
          !isCurrent && ref.kind !== 'tag' && guarded('rebase-ref', '⇡ Rebase current onto')
        ],
        [
          isBranch && hasRemote && guarded('push-ref', '⇡ Push'),
          upstream && action(ui, 'pull', `⇣ Pull from ${upstream.name}`, () => pullRef($, ref)),
          ref.kind === 'remote' && action(ui, 'fetch-ref', '⇣ Fetch', () => pullRef($, ref)),
          isBranch && Input && action(ui, 'rename', '✎ Rename…', () => $.state.set(RENAMING_REF, isRenaming ? null : ref.name), isRenaming),
          ref.kind === 'tag' && hasRemote && guarded('push-ref', '⇡ Push tag')
        ],
        [
          ref.kind === 'local' && guarded(armed('force-delete-branch') ? 'force-delete-branch' : 'delete-branch', '✕ Delete'),
          ref.kind === 'remote' && guarded('delete-remote-branch', '✕ Delete on remote'),
          ref.kind === 'tag' && guarded('delete-tag', '✕ Delete tag')
        ]
      ])}
      {isRenaming && Input && (
        <Input key="rename-branch" label="✎ " value={ref.name} submitLabel="rename" autoFocus onSubmit={(value: string) => renameBranch($, ref.name, value)} />
      )}
    </Box>
  )
}

function drawDetailBody (ui: Ui, $: Engine, detail: NonNullable<Detail>, diff: Diff, graph: Graph) {
  const { Box, Markdown, Text } = ui
  return (
    <Box flexDirection="column">
      <Text dimColor wrap="truncate-end">{detail.meta}</Text>
      {detail.signature && <Text color={SIGNATURE_COLOR[detail.signature.kind]} wrap="truncate-end">{detail.signature.text}</Text>}
      {detail.message !== '' && <Text> </Text>}
      {detail.message !== '' && <Markdown key="message" text={linkify(detail.message, graph.forge)} />}
      {detail.files.length > 0 && <Text> </Text>}
      {detail.files.length > 0 && <Text dimColor bold>{detail.compare ? 'FILES BETWEEN THEM' : 'FILES'}</Text>}
      {detail.files.map(file => drawFile(ui, $, detail.hash, file, diff?.hash === detail.hash && diff.path === file.path ? diff : null))}
    </Box>
  )
}

const SIGNATURE_COLOR: Record<NonNullable<NonNullable<Detail>['signature']>['kind'], string> = { good: 'green', unknown: 'yellow', bad: 'red', unchecked: 'gray' }

const STATUS_COLOR: Record<string, string> = { A: 'green', M: 'yellow', D: 'red', R: 'cyan', C: 'cyan', T: 'yellow', '?': 'green', U: 'red' }

/** A file is a button: pressing it opens its diff under it. */
function drawFile (ui: Ui, $: Engine, hash: string, file: FileChange, diff: Diff) {
  const { Box, Button, Code, Text } = ui
  return (
    <Box key={`entry-${file.path}`} flexDirection="column">
      <Button key={`file-${file.path}`} plain onPress={() => toggleDiff($, hash, file)}>
        <Text color={STATUS_COLOR[file.status] ?? 'white'}>{`${diff ? '▾' : '▸'} ${file.status === '?' ? 'U' : file.status} `}</Text>
        {file.oldPath ? <Text dimColor>{`${file.oldPath} → `}</Text> : ''}
        {file.path}
        {file.isBinary ? <Text dimColor>{'  binary'}</Text> : ''}
        {file.added !== undefined ? <Text color="green">{`  +${file.added}`}</Text> : ''}
        {file.deleted !== undefined ? <Text color="red">{` −${file.deleted}`}</Text> : ''}
      </Button>
      {diff && (
        <Box key={`diff-${file.path}`} flexDirection="column" marginLeft={2} marginBottom={1}>
          {diff.isLoading && <Text dimColor>Loading…</Text>}
          {diff.hunks !== '' && <Code source={diff.hunks} format="diff" path={file.path} />}
          {diff.note && <Text dimColor>{diff.note}</Text>}
        </Box>
      )}
    </Box>
  )
}
