// Git Graph as a Claude Code mod.
//
// - /git-graph opens a pane with the repo's history laid out in lanes, like the VS Code
//   extension: branches, remotes and tags as badges, author, date and hash per commit.
// - Click a branch or tag badge for its actions: checkout, merge, rebase, rename, push, pull,
//   delete, fetch, copy the name, and a link to open a pull request on GitHub, GitLab or Bitbucket.
// - Click a hash to open that commit under its row: its files and a row of actions. Mark one
//   to compare, and every commit opened next lists what changed between the two.
//   Click a file to read its diff right there.
// - Actions that change the repo (checkout, cherry-pick, revert, merge, rebase, reset) ask for
//   a second click to confirm; a tag is named in a field under the commit;
//   "new branch" hands the task to Claude, so it asks for the name and its own permission.
// - ⇣ fetch brings every remote's branches and tags, pruning the ones deleted there.
// - A repo with submodules gets a repo picker: each submodule's history draws the same way.
// - The branch picker draws every branch, the current one, or any one branch alone.
// - The find field keeps only the commits whose message, author, hash or refs hold the text.
// - Uncommitted changes get a row of their own above the commit they would follow; stashes
//   fork off the commit they were made on, to apply, pop, drop or branch from.
// - The settings (lanes, avatars, columns, date format, what is dim) are kept between sessions.
// - Keys, while the pane has the focus: j and k walk the commits, h goes to HEAD, s finds,
//   f fetches, r reloads; Esc closes the pane.
// - On desktop the lanes can be drawn as curves, an SVG per row, instead of glyphs.
// - The graph reloads after every turn, so commits Claude makes show up on their own.
import { atom, read } from 'claude-code'
import type { EngineInterface, EventOf, Register } from 'claude-code'

import { ancestorsOf, avatarOf, colorIndexOf, commitUrl, CURVE_CELL, curvesOf, DATE_ARGS, FORMAT, forgeOf, glyphOf, initialsOf, layout, linkify, matches, parseBranches, parseDiff, parseLog, parseNameStatus, parseNumstat, parseStashes, parseStatus, parseSubmodules, parseTagInput, pullRequestUrl, splitMatch, STASH_FORMAT, summary, withStashes, withStats, WORKTREE, worktreeRow } from './graph'
import type { Cell, Commit, CommitAction, DateFormat, Detail, Diff, FileChange, Graph, Note, Pending, Ref, RefAction, ResetMode, StashAction } from '../types'

type Engine = EngineInterface
type RenderOf<C extends string> = Extract<EventOf['ui.render'], { component: C }>
/** The element table of the surface drawing the pane. */
type Ui = any

const PANE = 'git-graph'
// Rows drawn at once; "show more" adds another page
const PAGE = 40

const GRAPH_REF = { plugin: 'git-graph', key: 'graph' } as const
const SELECTED_REF = { plugin: 'git-graph', key: 'selected' } as const
const DETAIL_REF = { plugin: 'git-graph', key: 'detail' } as const
const DIFF_REF = { plugin: 'git-graph', key: 'diff' } as const
const ALL_REF = { plugin: 'git-graph', key: 'allBranches' } as const
const FILTER_REF = { plugin: 'git-graph', key: 'branchFilter' } as const
const REPO_REF = { plugin: 'git-graph', key: 'repo' } as const
const SHOWN_REF = { plugin: 'git-graph', key: 'shown' } as const
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
const SHOWN = atom(SHOWN_REF, PAGE)
const COMPACT = atom(COMPACT_REF, false)
const SETTINGS = atom(SETTINGS_REF, false)
const MUTE_MERGES = atom(MUTE_MERGES_REF, true)
const CURVES = atom(CURVES_REF, false)
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
// An avatar and the space after it
const AVATAR_WIDTH = 3

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
    await $.state.set(SHOWN_REF, PAGE)
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
    const branches = parseBranches(await git($, ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes']).catch(() => ''))
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
    graph = { commits: [], branch: '', changes: [], branches: [], remotes: [], head: '', forge: null, defaultBranch: 'main', repos: await listRepos($).catch(() => []), error: /not a git repository/i.test(message) ? 'This folder is not a git repository.' : message, loadedAt: await $.clock.now() }
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
      git($, ['show', '-s', '--format=%an <%ae> · %ad%n%B', '--date=format:%d %b %Y %H:%M', hash]),
      git($, ['diff-tree', '-r', '-M', '--name-status', '--no-commit-id', ...range]),
      git($, ['diff-tree', '-r', '-M', '--numstat', '--no-commit-id', ...range]).catch(() => '')
    ])
    const [meta = '', ...message] = shown.trimEnd().split('\n')
    const files = withStats(parseNameStatus(names), parseNumstat(numstat))
    return { hash, meta: `${meta}  ·  ${summary(files)}`, message: message.join('\n').trim(), files }
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
  await $.state.set(COMPARE_REF, base === hash ? null : hash)
  if (base !== hash) await note($, 'info', `comparing with ${hash === WORKTREE ? 'the working tree' : hash.slice(0, HASH_WIDTH)}: open another commit`)
  else await $.state.set(NOTE_REF, null)
}

async function stopComparing ($: Engine) {
  await $.state.set(COMPARE_REF, null)
  await $.state.set(NOTE_REF, null)
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
  const next = at === -1 ? (by === 1 ? 0 : rows.length - 1) : Math.min(rows.length - 1, Math.max(0, at + by))
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

/** Shows pages until the row at `index` is drawn. */
async function reveal ($: Engine, index: number) {
  const shown = await read($, SHOWN)
  if (index >= shown) await $.state.set(SHOWN_REF, (Math.floor(index / PAGE) + 1) * PAGE)
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
  await $.state.set(SHOWN_REF, PAGE)
  await clearSelection($)
  await reload($)
}

/** The branch picker's value: `all`, `current`, or `ref:<branch>` to draw that branch alone. */
async function pickBranches ($: Engine, value: string) {
  if (value === 'all' || value === 'current') {
    await $.state.set(ALL_REF, value === 'all')
    await $.state.set(FILTER_REF, null)
  } else {
    await $.state.set(FILTER_REF, value.slice(4))
  }
  await $.state.set(SHOWN_REF, PAGE)
  await reload($)
}

async function find ($: Engine, value: string) {
  // Kept as typed: the field is drawn from it, and a trimmed space would vanish while typing
  await $.state.set(QUERY_REF, value)
  await $.state.set(SHOWN_REF, PAGE)
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

async function note ($: Engine, kind: Note['kind'], text: string) {
  await $.state.set(NOTE_REF, { kind, text })
  if (kind !== 'info') $.ui.toast(`Git Graph · ${text}`)
}

// ── Actions ────────────────────────────────────────────────────────────────────

/** Where a checkout of this commit lands: its local branch, a branch tracking its remote one, or a detached HEAD. */
function checkoutTarget (commit: Commit): { label: string; args: string[] } {
  const local = commit.refs.find(ref => ref.kind === 'local' || (ref.kind === 'head' && ref.name !== 'HEAD'))
  if (local) return { label: local.name, args: ['switch', local.name] }
  const remote = commit.refs.find(ref => ref.kind === 'remote')
  if (remote) {
    const name = remote.name.slice(remote.name.indexOf('/') + 1)
    return { label: `${name} (tracking ${remote.name})`, args: ['switch', '--track', remote.name] }
  }
  return { label: `${commit.hash.slice(0, HASH_WIDTH)} (detached)`, args: ['switch', '--detach', commit.hash] }
}

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
function confirmText (action: CommitAction, commit: Commit, branch: string): string {
  const short = commit.hash.slice(0, HASH_WIDTH)
  switch (action) {
    case 'checkout': return `confirm: checkout ${checkoutTarget(commit).label}?`
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
        const target = checkoutTarget(commit)
        await git($, target.args)
        await note($, 'ok', `checked out ${target.label}`)
        break
      }
      case 'cherry-pick':
        await undoOnConflict($, ['cherry-pick', hash], ['cherry-pick', '--abort'])
        await note($, 'ok', `cherry-picked ${short} onto ${graph.branch}`)
        break
      case 'revert':
        // A merge is reverted against its first parent, the side it was merged into
        await undoOnConflict($, ['revert', '--no-edit', ...(commit.parents.length > 1 ? ['-m', '1'] : []), hash], ['revert', '--abort'])
        await note($, 'ok', `reverted ${short} on ${graph.branch}`)
        break
      case 'merge':
        await undoOnConflict($, ['merge', '--no-edit', mergeTarget(commit)], ['merge', '--abort'])
        await note($, 'ok', `merged ${mergeTarget(commit)} into ${graph.branch}`)
        break
      case 'rebase':
        await undoOnConflict($, ['rebase', hash], ['rebase', '--abort'])
        await note($, 'ok', `rebased ${graph.branch} onto ${short}`)
        break
      case 'reset':
        await git($, ['reset', `--${mode}`, hash])
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
    await git($, ['tag', ...(message ? ['-a', name, '-m', message] : [name]), hash])
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

/** A remote branch `origin/feature/x` → its remote and its branch there. */
function splitRemote (name: string, remotes: string[]) {
  const remote = remotes.find(item => name.startsWith(`${item}/`)) ?? name.slice(0, name.indexOf('/'))
  return { remote, branch: name.slice(remote.length + 1) }
}

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
          const { branch } = splitRemote(ref.name, graph.remotes)
          // A local branch of that name already exists: switch to it rather than fail
          await git($, graph.branches.includes(branch) ? ['switch', branch] : ['switch', '--track', ref.name])
        } else if (ref.kind === 'tag') {
          await git($, ['switch', '--detach', ref.name])
        } else {
          await git($, ['switch', ref.name])
        }
        await note($, 'ok', `checked out ${ref.name}`)
        break
      case 'merge-ref':
        await undoOnConflict($, ['merge', '--no-edit', ref.name], ['merge', '--abort'])
        await note($, 'ok', `merged ${ref.name} into ${graph.branch}`)
        break
      case 'rebase-ref':
        await undoOnConflict($, ['rebase', ref.name], ['rebase', '--abort'])
        await note($, 'ok', `rebased ${graph.branch} onto ${ref.name}`)
        break
      case 'delete-branch':
        try {
          await git($, ['branch', '-d', ref.name])
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
        await git($, ['branch', '-D', ref.name])
        await note($, 'ok', `deleted branch ${ref.name}`)
        break
      case 'delete-remote-branch': {
        const target = splitRemote(ref.name, graph.remotes)
        await git($, ['push', target.remote, '--delete', target.branch], [0], 120000)
        await note($, 'ok', `deleted ${target.branch} on ${target.remote}`)
        break
      }
      case 'delete-tag':
        await git($, ['tag', '-d', ref.name])
        await note($, 'ok', `deleted tag ${ref.name}`)
        break
      case 'push-ref':
        await git($, ref.kind === 'tag' ? ['push', remote, `refs/tags/${ref.name}`] : ['push', '-u', remote, ref.name], [0], 120000)
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
    await git($, ['fetch', '--all', '--prune', '--tags'], [0], 300000)
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
      await git($, ['fetch', target.remote, target.branch], [0], 120000)
      await note($, 'ok', `fetched ${ref.name}`)
    } else {
      // Only fast-forwards: a pull that would merge is Claude's to resolve
      await git($, ['pull', '--ff-only'], [0], 120000)
      await note($, 'ok', `pulled ${ref.name}`)
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
    await git($, ['branch', '-m', from, to])
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
    await git($, ['stash', 'push', '--include-untracked', ...(message.trim() ? ['-m', message.trim()] : [])])
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
  const verb = action.slice(6)
  try {
    await git($, ['stash', verb, name])
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
    await git($, ['stash', 'branch', name, stash.stash ?? 'stash@{0}'])
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
  const shown = await read($, SHOWN)
  const columns = Math.max(40, e.props.bodyColumns)
  const count = graph?.commits.filter(commit => !commit.kind).length ?? 0
  const typed = await read($, QUERY)
  const query = typed.trim()
  const found = query === '' ? graph?.commits ?? [] : (graph?.commits ?? []).filter(commit => matches(commit, query))
  const matching = found.length

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
      <Box flexDirection="row" justifyContent="space-between">
        <Text wrap="truncate-end">
          <Text color="green">{graph?.branch ? `⎇ ${graph.branch}` : 'Git Graph'}</Text>
          {graph && graph.changes.length > 0 && <Text color="yellow">{`  ● ${graph.changes.length} uncommitted`}</Text>}
          <Text dimColor>{graph && !graph.error ? `  ·  ${count} commits${count >= limit ? ` (last ${limit})` : ''}` : ''}</Text>
        </Text>
        <Box flexDirection="row" columnGap={2}>
          <Button key="settings" label={settingsOpen ? '⚙ ▾' : '⚙'} plain dimColor={!settingsOpen} onPress={() => toggleSettings($)} />
          {Select && graph && graph.branches.length > 0
            ? (
              <Select
                key="branches"
                value={filter !== null ? `ref:${filter}` : allBranches ? 'all' : 'current'}
                options={[
                  { value: 'all', label: 'all branches' },
                  { value: 'current', label: 'current branch' },
                  ...graph.branches.map(name => ({ value: `ref:${name}`, label: name }))
                ]}
                onSelect={(value: string) => pickBranches($, value)}
              />
              )
            : <Button key="branches" label={allBranches ? 'all branches' : 'current branch'} plain dimColor onPress={() => toggleAll($)} />}
          {graph && graph.remotes.length > 0 && <Button key="fetch" label="⇣ fetch" hotkey="f" plain dimColor onPress={() => fetchAll($)} />}
          <Button key="reload" label="↻" hotkey="r" plain onPress={() => reload($)} />
        </Box>
      </Box>
      {ui.Input && graph && !graph.error && (
        <Box flexDirection="row" columnGap={2}>
          <Box flexGrow={1}>
            <Input key="find" label="⌕ " placeholder="find a message, author, hash or branch" value={typed} submitLabel="find" onInput={(value: string) => find($, value)} onSubmit={(value: string) => find($, value)} />
          </Box>
          {query !== '' && <Text dimColor>{`${matching} ${matching === 1 ? 'match' : 'matches'}`}</Text>}
          {query !== '' && <Button key="find-clear" label="✕ clear" plain dimColor onPress={() => find($, '')} />}
        </Box>
      )}
      {settingsOpen && (
        <Box key="settings-row" flexDirection="row" columnGap={2} flexWrap="wrap">
          <Text dimColor>lanes:</Text>
          <Button key="compact" label={compact ? 'compact' : 'spaced'} plain onPress={() => toggleCompact($)} />
          {ui.Svg && <Button key="curves" label={curves ? 'curves' : 'glyphs'} plain onPress={() => toggleCurves($)} />}
          <Text dimColor>columns:</Text>
          <Button key="show-author" label={`${showAuthor ? '☑' : '☐'} author`} plain onPress={() => toggleShowAuthor($)} />
          <Button key="avatars" label={`${avatars ? '☑' : '☐'} avatars`} plain onPress={() => toggleAvatars($)} />
          <Button key="show-date" label={`${showDate ? '☑' : '☐'} date`} plain onPress={() => toggleShowDate($)} />
          <Button key="date-format" label={`date: ${dateFormat}`} plain onPress={() => cycleDateFormat($)} />
          <Text dimColor>dim:</Text>
          <Button key="mute-merges" label={`${muteMerges ? '☑' : '☐'} merge commits`} plain onPress={() => toggleMuteMerges($)} />
          <Button key="mute-others" label={`${muteOthers ? '☑' : '☐'} commits HEAD does not reach`} plain onPress={() => toggleMuteOthers($)} />
        </Box>
      )}
      {compareBase !== null && (
        <Box flexDirection="row" columnGap={2}>
          <Text color="cyan" wrap="truncate-end">{`⇄ comparing with ${compareBase === WORKTREE ? 'the working tree' : compareBase.slice(0, HASH_WIDTH)}`}</Text>
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

  const visible = found.slice(0, shown)
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
    rows.push(drawRow(ui, $, commit, cellsOf(commit), { curves: curves && query === '', avatars, showAuthor, showDate, graphWidth, textWidth, showMeta, isSelected, query, openRef, isMuted: isMuted(commit) }))
    const badge = openRef && commit.refs.find(ref => ref.kind === openRef.kind && ref.name === openRef.name)
    if (badge) rows.push(drawRefActions(ui, $, badge, pending, renaming === badge.name, graph, graphWidth))
    if (isSelected) rows.push(drawDetail(ui, $, commit, detail?.hash === commit.hash ? detail : null, diff, pending, { isTagging: tagging === commit.hash, isStashing: stashing === commit.hash, compareBase }, graph, graphWidth))
  }

  return (
    <Box flexDirection="column">
      {header}
      <Text> </Text>
      {rows}
      {found.length > shown && (
        <Button key="more" label={`show ${Math.min(PAGE, found.length - shown)} more`} plain dimColor onPress={() => $.state.set(SHOWN_REF, shown + PAGE)} />
      )}
      <Text> </Text>
      <Box key="keys" flexDirection="row" columnGap={2} flexWrap="wrap">
        <Button key="next" label="next" hotkey="j" plain dimColor onPress={() => step($, 1)} />
        <Button key="previous" label="previous" hotkey="k" plain dimColor onPress={() => step($, -1)} />
        <Button key="head" label="HEAD" hotkey="h" plain dimColor onPress={() => goHead($)} />
        {Input && <Button key="focus-find" label="find" hotkey="s" plain dimColor onPress={() => focusFind($)} />}
        <Text dimColor>esc: close</Text>
      </Box>
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
          <Box width={graphWidth} height={1} flexShrink={0} overflow="hidden">
            <Svg source={curvesOf(cells)} alt="" width={Math.max(1, cells.length) * CURVE_CELL.width} height={CURVE_CELL.height} />
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

/** The open commit, under its own row: actions, then its message and files. */
function drawDetail (
  ui: Ui, $: Engine, commit: Commit, detail: Detail, diff: Diff,
  pending: Pending | null, fields: { isTagging: boolean; isStashing: boolean; compareBase: string | null }, graph: Graph, graphWidth: number
) {
  const { Box, Button, Text } = ui
  const isBase = fields.compareBase === commit.hash
  const compareButton = (
    <Button key="compare" label={isBase ? '⇄ marked: open another commit · press to unmark' : fields.compareBase ? '⇄ compare with this instead' : '⇄ compare…'} plain dimColor={!isBase} onPress={() => toggleCompare($, commit.hash)} />
  )
  const isWorktree = commit.kind === 'worktree'

  return (
    <Box key={`detail-${commit.hash}`} flexDirection="column" marginLeft={graphWidth} marginTop={1} marginBottom={1} borderStyle="round" borderColor="gray" paddingX={1}>
      <Text color="yellow" wrap="truncate-end">{isWorktree ? 'Uncommitted Changes' : commit.stash ? `${commit.stash}  ${commit.hash}` : commit.hash}</Text>
      {compareButton}
      {isWorktree
        ? drawWorktreeActions(ui, $, fields.isStashing)
        : commit.kind === 'stash'
          ? drawStashActions(ui, $, commit, pending, fields.isStashing)
          : drawCommitActions(ui, $, commit, pending, fields.isTagging, graph)}
      <Text> </Text>
      {!detail || detail.isLoading
        ? <Text dimColor>Loading…</Text>
        : drawDetailBody(ui, $, detail, diff, graph)}
    </Box>
  )
}

function drawWorktreeActions (ui: Ui, $: Engine, isStashing: boolean) {
  const { Box, Button, Input } = ui
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" columnGap={2} flexWrap="wrap">
        <Button key="commit" label="✎ commit…" plain onPress={() => commitChanges($)} />
        {Input && <Button key="stash" label="⊟ stash…" plain dimColor onPress={() => toggleStashing($, WORKTREE)} />}
      </Box>
      {isStashing && Input && (
        <Input key="stash-message" label="⊟ " placeholder="a message for the stash, or none" submitLabel="stash" autoFocus onSubmit={(value: string) => stashChanges($, value)} />
      )}
    </Box>
  )
}

function drawStashActions (ui: Ui, $: Engine, stash: Commit, pending: Pending | null, isBranching: boolean) {
  const { Box, Button, Input } = ui
  const armed = (action: StashAction) => pending?.action === action && pending.hash === stash.hash
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" columnGap={2} flexWrap="wrap">
        <Button key="stash-apply" label="⇣ apply" plain onPress={() => stashAction($, 'stash-apply', stash)} />
        <Button key="stash-pop" label={armed('stash-pop') ? `confirm: apply and drop ${stash.stash}?` : '⇣ pop'} plain dimColor={!armed('stash-pop')} onPress={() => stashAction($, 'stash-pop', stash)} />
        {Input && <Button key="stash-branch" label="+ branch…" plain dimColor onPress={() => toggleStashing($, stash.hash)} />}
        <Button key="stash-drop" label={armed('stash-drop') ? `confirm: drop ${stash.stash}?` : '✕ drop'} plain dimColor={!armed('stash-drop')} onPress={() => stashAction($, 'stash-drop', stash)} />
      </Box>
      {isBranching && Input && (
        <Input key="stash-branch-name" label="+ " placeholder="a name for the new branch" submitLabel="branch" autoFocus onSubmit={(value: string) => branchFromStash($, stash, value)} />
      )}
    </Box>
  )
}

function drawCommitActions (ui: Ui, $: Engine, commit: Commit, pending: Pending | null, isTagging: boolean, graph: Graph) {
  const { Box, Button, Input, Text } = ui
  const isHead = commit.refs.some(ref => ref.kind === 'head')
  const armed = (action: CommitAction) => pending?.action === action && pending.hash === commit.hash
  /** A button that asks for a second click before it changes the repo. */
  const guarded = (action: CommitAction, label: string) => (
    <Button key={action} label={armed(action) ? confirmText(action, commit, graph.branch) : label} plain dimColor={!armed(action)} onPress={() => arm($, action, commit.hash)} />
  )
  const { Link } = ui
  const page = commitUrl(graph.forge, commit.hash)
  const actions = [
    page && <Link key="web" href={page} label={`↗ ${graph.forge?.host}`} />,
    <Button key="copy" label="⧉ copy hash" plain onPress={() => copyText($, commit.hash, commit.hash.slice(0, HASH_WIDTH))} />,
    <Button key="copy-subject" label="⧉ copy subject" plain dimColor onPress={() => copyText($, commit.subject, 'the subject')} />,
    !isHead && guarded('checkout', '⎇ checkout'),
    <Button key="branch" label="+ new branch here" plain dimColor onPress={() => newBranch($, commit)} />,
    <Button key="tag" label="◆ tag…" plain dimColor onPress={() => toggleTagging($, commit.hash)} />,
    !isHead && commit.parents.length === 1 && guarded('cherry-pick', '⇣ cherry-pick'),
    guarded('revert', '↶ revert'),
    !isHead && guarded('merge', '⤞ merge into current'),
    !isHead && guarded('rebase', '⇡ rebase current onto this'),
    !isHead && guarded('reset', '↺ reset current to this')
  ].filter(Boolean)

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" columnGap={2} flexWrap="wrap">{actions}</Box>
      {armed('reset') && (
        <Box flexDirection="row" columnGap={2} flexWrap="wrap">
          <Text color="yellow">{confirmText('reset', commit, graph.branch)}</Text>
          <Button key="reset-soft" label="soft: keep changes staged" plain onPress={() => run($, 'reset', commit.hash, 'soft')} />
          <Button key="reset-mixed" label="mixed: keep changes unstaged" plain onPress={() => run($, 'reset', commit.hash, 'mixed')} />
          <Button key="reset-hard" label="hard: discard changes" plain onPress={() => run($, 'reset', commit.hash, 'hard')} />
          <Button key="reset-cancel" label="cancel" plain dimColor onPress={() => $.state.set(PENDING_REF, null)} />
        </Box>
      )}
      {isTagging && Input && (
        <Input key="tag-name" label="◆ " placeholder="v1.2  or  v1.2: message for an annotated tag" submitLabel="tag" autoFocus onSubmit={(value: string) => tag($, commit.hash, value)} />
      )}
    </Box>
  )
}

/** A badge's actions, under its row: what fits its kind, and whether it is checked out. */
function drawRefActions (ui: Ui, $: Engine, ref: Ref, pending: Pending | null, isRenaming: boolean, graph: Graph, graphWidth: number) {
  const { Box, Button, Input, Link, Text } = ui
  const isCurrent = ref.kind === 'head'
  const branchName = ref.kind === 'remote' ? splitRemote(ref.name, graph.remotes).branch : ref.name
  const pullRequest = ref.kind !== 'tag' && ref.name !== 'HEAD' ? pullRequestUrl(graph.forge, branchName, graph.defaultBranch) : null
  const isBranch = (ref.kind === 'head' && ref.name !== 'HEAD') || ref.kind === 'local'
  const armed = (action: RefAction) => pending?.action === action && pending.hash === ref.name
  const guarded = (action: RefAction, label: string) => (
    <Button key={action} label={armed(action) ? refConfirmText(action, ref, graph) : label} plain dimColor={!armed(action)} onPress={() => armRef($, action, ref)} />
  )
  const hasRemote = graph.remotes.length > 0
  const actions = [
    <Button key="copy-name" label="⧉ copy name" plain onPress={() => copyText($, ref.name, ref.name)} />,
    pullRequest && <Link key="pull-request" href={pullRequest} label={`↗ pull request into ${graph.defaultBranch}`} />,
    !isCurrent && guarded('checkout-ref', '⎇ checkout'),
    !isCurrent && guarded('merge-ref', '⤞ merge into current'),
    !isCurrent && ref.kind !== 'tag' && guarded('rebase-ref', '⇡ rebase current onto this'),
    isBranch && Input && <Button key="rename" label="✎ rename…" plain dimColor onPress={() => $.state.set(RENAMING_REF, isRenaming ? null : ref.name)} />,
    isBranch && hasRemote && guarded('push-ref', '⇡ push'),
    isCurrent && hasRemote && <Button key="pull" label="⇣ pull" plain dimColor onPress={() => pullRef($, ref)} />,
    ref.kind === 'remote' && <Button key="fetch-ref" label="⇣ fetch" plain dimColor onPress={() => pullRef($, ref)} />,
    ref.kind === 'local' && guarded(armed('force-delete-branch') ? 'force-delete-branch' : 'delete-branch', '✕ delete'),
    ref.kind === 'remote' && guarded('delete-remote-branch', '✕ delete on remote'),
    ref.kind === 'tag' && hasRemote && guarded('push-ref', '⇡ push tag'),
    ref.kind === 'tag' && guarded('delete-tag', '✕ delete tag')
  ].filter(Boolean)

  return (
    <Box key={`refs-${ref.kind}-${ref.name}`} flexDirection="column" marginLeft={graphWidth} marginBottom={1} borderStyle="round" borderColor={REF_COLOR[ref.kind]} paddingX={1}>
      <Text color={REF_COLOR[ref.kind]} wrap="truncate-end">{`${ref.kind === 'tag' ? '◆ tag' : ref.kind === 'remote' ? 'remote branch' : isCurrent ? 'current branch' : 'branch'} ${ref.name}`}</Text>
      <Box flexDirection="row" columnGap={2} flexWrap="wrap">{actions}</Box>
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
      {detail.message !== '' && <Text> </Text>}
      {detail.message !== '' && <Markdown key="message" text={linkify(detail.message, graph.forge)} />}
      {detail.files.length > 0 && <Text> </Text>}
      {detail.files.map(file => drawFile(ui, $, detail.hash, file, diff?.hash === detail.hash && diff.path === file.path ? diff : null))}
    </Box>
  )
}

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
