// Git Graph as a Claude Code mod.
//
// - /git-graph opens a pane with the repo's history laid out in lanes, like the VS Code
//   extension: branches, remotes and tags as badges, author, date and hash per commit.
// - Click a hash to open that commit under its row: its files and a row of actions.
//   Click a file to read its diff right there.
// - Actions that change the repo (checkout, cherry-pick) ask for a second click to confirm;
//   "new branch" hands the task to Claude, so it asks for the name and its own permission.
// - The branch picker draws every branch, the current one, or any one branch alone.
// - The find field keeps only the commits whose message, author, hash or refs hold the text.
// - Uncommitted changes get a row of their own above the commit they would follow.
// - The graph reloads after every turn, so commits Claude makes show up on their own.
import { atom, read } from 'claude-code'
import type { EngineInterface, EventOf, Register } from 'claude-code'

import { FORMAT, layout, matches, parseBranches, parseDiff, parseLog, parseNameStatus, parseStatus, splitMatch, WORKTREE, worktreeRow } from './graph'
import type { Commit, Detail, Diff, FileChange, Graph, Note, Pending, Ref } from '../types'

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
const SHOWN_REF = { plugin: 'git-graph', key: 'shown' } as const
const COMPACT_REF = { plugin: 'git-graph', key: 'compact' } as const
const PENDING_REF = { plugin: 'git-graph', key: 'pending' } as const
const NOTE_REF = { plugin: 'git-graph', key: 'note' } as const
const QUERY_REF = { plugin: 'git-graph', key: 'query' } as const
const GRAPH = atom(GRAPH_REF, null)
const SELECTED = atom(SELECTED_REF, null)
const DETAIL = atom(DETAIL_REF, null)
const DIFF = atom(DIFF_REF, null)
const ALL = atom(ALL_REF, true)
const FILTER = atom(FILTER_REF, null)
const SHOWN = atom(SHOWN_REF, PAGE)
const COMPACT = atom(COMPACT_REF, false)
const PENDING = atom(PENDING_REF, null)
const NOTE = atom(NOTE_REF, null)
const QUERY = atom(QUERY_REF, '')

// One color per lane, cycling, like Git Graph's palette
const LANE_COLORS = ['blue', 'magenta', 'green', 'yellow', 'cyan', 'red']
const REF_COLOR: Record<Ref['kind'], string> = { head: 'green', local: 'blue', remote: 'magenta', tag: 'yellow' }
const NOTE_COLOR: Record<Note['kind'], string> = { ok: 'green', error: 'red', info: 'cyan' }
// Glyphs whose stroke reaches the cell's sides: they get a full-width line behind them
const CROSSING = new Set(['┼'])
const AUTHOR_WIDTH = 14
const DATE_WIDTH = 17
const HASH_WIDTH = 7

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
    return next(e)
  })
}

// ── Reading the repo ───────────────────────────────────────────────────────────

async function git ($: Engine, args: string[], okCodes: number[] = [0]) {
  const cwd = await $.session.cwd()
  const result = await $.process.run(['git', '-C', cwd, ...args])
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
  let filter = await read($, FILTER)
  let graph: Graph
  try {
    const branches = parseBranches(await git($, ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes']).catch(() => ''))
    // A picked branch that was deleted since: back to the branches the toggle says
    if (filter !== null && !branches.includes(filter)) {
      filter = null
      await $.state.set(FILTER_REF, null)
    }
    const [remotes, branch, head, status, log] = await Promise.all([
      git($, ['remote']),
      git($, ['branch', '--show-current']).catch(() => ''),
      git($, ['rev-parse', 'HEAD']).catch(() => ''),
      git($, ['status', '--porcelain=v1', '-uall']).catch(() => ''),
      git($, [
        'log', ...(filter !== null ? [filter] : allBranches ? ['--all'] : []), '--topo-order', `-n${limit}`,
        `--format=${FORMAT}`, '--date=format:%d %b %Y %H:%M', '--'
      ])
    ])
    const parsed = parseLog(log, new Set(remotes.split('\n').map(name => name.trim()).filter(Boolean)))
    const changes = parseStatus(status)
    // The uncommitted row leads to HEAD, so the layout draws its line down to it
    const headHash = head.trim()
    if (changes.length > 0) parsed.unshift(worktreeRow(changes, parsed.some(commit => commit.hash === headHash) ? headHash : null))
    graph = {
      commits: layout(parsed),
      branch: branch.trim() || '(detached HEAD)',
      changes,
      branches,
      error: null,
      loadedAt: await $.clock.now()
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    graph = { commits: [], branch: '', changes: [], branches: [], error: /not a git repository/i.test(message) ? 'This folder is not a git repository.' : message, loadedAt: await $.clock.now() }
  }
  await $.state.set(GRAPH_REF, graph)

  // A selected commit that is no longer in the graph loses its details
  const selected = await read($, SELECTED)
  if (selected && !graph.commits.some(commit => commit.hash === selected)) await clearSelection($)
}

async function clearSelection ($: Engine) {
  await $.state.set(SELECTED_REF, null)
  await $.state.set(DETAIL_REF, null)
  await $.state.set(DIFF_REF, null)
  await $.state.set(PENDING_REF, null)
}

async function select ($: Engine, hash: string) {
  if ((await read($, SELECTED)) === hash) return clearSelection($)
  await $.state.set(SELECTED_REF, hash)
  await $.state.set(PENDING_REF, null)
  await $.state.set(DIFF_REF, null)
  await $.state.set(DETAIL_REF, { hash, meta: '', message: '', files: [], isLoading: true })
  const detail = await readDetail($, hash)
  if ((await read($, SELECTED)) === hash) await $.state.set(DETAIL_REF, detail)
}

async function readDetail ($: Engine, hash: string): Promise<NonNullable<Detail>> {
  const graph = await read($, GRAPH)
  if (hash === WORKTREE) {
    const files = graph?.changes ?? []
    return { hash, meta: `${files.length} ${files.length === 1 ? 'file' : 'files'} changed in the working tree`, message: '', files }
  }
  const parent = graph?.commits.find(commit => commit.hash === hash)?.parents[0]
  try {
    const [shown, names] = await Promise.all([
      git($, ['show', '-s', '--format=%an <%ae> · %ad%n%B', '--date=format:%d %b %Y %H:%M', hash]),
      // A merge is shown against its first parent, as Git Graph does
      git($, ['diff-tree', '-r', '-M', '--name-status', '--no-commit-id', ...(parent ? [parent, hash] : ['--root', hash])])
    ])
    const [meta = '', ...message] = shown.trimEnd().split('\n')
    return { hash, meta, message: message.join('\n').trim(), files: parseNameStatus(names) }
  } catch (error) {
    return { hash, meta: `Could not read the commit: ${error instanceof Error ? error.message : String(error)}`, message: '', files: [] }
  }
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
    if (hash === WORKTREE) {
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

async function copyHash ($: Engine, hash: string) {
  const platform = (await $.process.run(['uname', '-s']).catch(() => undefined))?.stdout.trim()
  const argv = platform === 'Darwin'
    ? ['sh', '-c', 'printf %s "$GG_TEXT" | pbcopy']
    : platform === 'Linux'
      ? ['sh', '-c', 'printf %s "$GG_TEXT" | (wl-copy 2>/dev/null || xclip -selection clipboard 2>/dev/null || xsel -b)']
      : ['cmd', '/c', 'echo|set /p="%GG_TEXT%"| clip']
  const result = await $.process.run(argv, { env: { GG_TEXT: hash } }).catch(() => undefined)
  if (result?.exitCode === 0) await note($, 'ok', `copied ${hash.slice(0, HASH_WIDTH)}`)
  else await note($, 'error', 'could not reach the clipboard')
}

/** First click arms the action, the second one runs it. */
async function arm ($: Engine, action: Pending['action'], hash: string) {
  const pending = await read($, PENDING)
  if (!pending || pending.action !== action || pending.hash !== hash) {
    await $.state.set(PENDING_REF, { action, hash })
    return
  }
  await $.state.set(PENDING_REF, null)
  if (isBusy) return note($, 'error', 'Claude is working: try again when the turn ends')

  const graph = await read($, GRAPH)
  const commit = graph?.commits.find(item => item.hash === hash)
  if (!commit) return

  const dirty = (await git($, ['status', '--porcelain']).catch(() => '')).trim()
  if (dirty) return note($, 'error', 'uncommitted changes: commit or stash them first')

  try {
    if (action === 'checkout') {
      const target = checkoutTarget(commit)
      await git($, target.args)
      await note($, 'ok', `checked out ${target.label}`)
    } else {
      try {
        await git($, ['cherry-pick', hash])
        await note($, 'ok', `cherry-picked ${hash.slice(0, HASH_WIDTH)} onto ${graph?.branch}`)
      } catch (error) {
        await git($, ['cherry-pick', '--abort']).catch(() => '')
        throw error
      }
    }
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

async function drawPane ($: Engine, e: RenderOf<'Pane'>) {
  const ui: Ui = $.ui.resolve(e)
  const { Box, Button, Input, Select, Text } = ui
  const graph = await read($, GRAPH)
  const selected = await read($, SELECTED)
  const detail = await read($, DETAIL)
  const diff = await read($, DIFF)
  const allBranches = await read($, ALL)
  const filter = await read($, FILTER)
  const compact = await read($, COMPACT)
  const pending = await read($, PENDING)
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
      <Box flexDirection="row" justifyContent="space-between">
        <Text wrap="truncate-end">
          <Text color="green">{graph?.branch ? `⎇ ${graph.branch}` : 'Git Graph'}</Text>
          {graph && graph.changes.length > 0 && <Text color="yellow">{`  ● ${graph.changes.length} uncommitted`}</Text>}
          <Text dimColor>{graph && !graph.error ? `  ·  ${count} commits${count >= limit ? ` (last ${limit})` : ''}` : ''}</Text>
        </Text>
        <Box flexDirection="row" columnGap={2}>
          <Button key="compact" label={compact ? 'compact' : 'spaced'} plain dimColor onPress={() => toggleCompact($)} />
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
          <Button key="reload" label="↻" plain onPress={() => reload($)} />
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
    return commit.kind === 'worktree' ? cells.map(cell => (cell.ch === '●' ? { ...cell, ch: '○' } : cell)) : cells
  }
  const graphWidth = Math.max(...visible.map(commit => cellsOf(commit).length)) + 1
  const metaWidth = AUTHOR_WIDTH + DATE_WIDTH + 2
  const showMeta = columns >= graphWidth + metaWidth + HASH_WIDTH + 30
  const textWidth = columns - graphWidth - HASH_WIDTH - 3 - (showMeta ? metaWidth + 1 : 0)

  const rows = []
  for (const commit of visible) {
    const isSelected = commit.hash === selected
    rows.push(drawRow(Box, Button, Text, $, commit, cellsOf(commit), { graphWidth, textWidth, showMeta, isSelected, query }))
    if (isSelected) rows.push(drawDetail(ui, $, commit, detail?.hash === commit.hash ? detail : null, diff, pending, graph, graphWidth))
  }

  return (
    <Box flexDirection="column">
      {header}
      <Text> </Text>
      {rows}
      {found.length > shown && (
        <Button key="more" label={`show ${Math.min(PAGE, found.length - shown)} more`} plain dimColor onPress={() => $.state.set(SHOWN_REF, shown + PAGE)} />
      )}
    </Box>
  )
}

/** A text with the part that matches the find field lit. */
function drawLit (Text: any, text: string, query: string, style: Record<string, boolean>) {
  const [before, lit, after] = splitMatch(text, query)
  if (lit === '') return <Text {...style}>{text}</Text>
  return <Text {...style}>{before}<Text color="yellow" bold underline>{lit}</Text>{after}</Text>
}

/** One graph cell, in a box one column wide so every row lines up in a proportional font. */
function drawCell (Box: any, Text: any, ch: string, lane: number, key: number) {
  const color = LANE_COLORS[lane % LANE_COLORS.length]
  // A horizontal line is drawn longer than its box and clipped: in a proportional font a
  // single ─ is narrower than the column, which left gaps in the merge lines
  if (ch === '─') {
    return <Box key={key} width={1} flexShrink={0} overflow="hidden"><Text color={color} wrap="truncate">{'────'}</Text></Box>
  }
  if (CROSSING.has(ch)) {
    return (
      <Box key={key} width={1} flexShrink={0} overflow="hidden">
        <Box position="absolute" top={0} left={0}><Text color={color} wrap="truncate">{'────'}</Text></Box>
        <Text color={color}>│</Text>
      </Box>
    )
  }
  return <Box key={key} width={1} flexShrink={0}><Text color={color}>{ch}</Text></Box>
}

function drawRow (
  Box: any, Button: any, Text: any, $: Engine, commit: Commit, cells: Commit['cells'],
  { graphWidth, textWidth, showMeta, isSelected, query }: { graphWidth: number; textWidth: number; showMeta: boolean; isSelected: boolean; query: string }
) {
  const isMerge = commit.parents.length > 1
  // The text is cut to one line by hand: a narrow pane would otherwise wrap it.
  // Narrow panes also shorten long branch names, so the subject keeps some room.
  let room = Math.max(10, textWidth)
  const maxRef = textWidth < 70 ? 22 : 60
  const refs = commit.refs.map(ref => {
    const badge = `[${cut(ref.kind === 'tag' ? `◆ ${ref.name}` : ref.name, maxRef)}] `
    const text = badge.length <= room ? badge : ''
    room -= text.length
    return { ref, text }
  }).filter(item => item.text)

  return (
    <Box key={commit.hash} flexDirection="row">
      <Box width={graphWidth} flexShrink={0} flexDirection="row">
        {cells.map((cell, i) => drawCell(Box, Text, cell.ch, cell.lane, i))}
      </Box>
      <Box flexGrow={1} flexShrink={1} height={1} overflow="hidden">
        <Text wrap="truncate-end">
          {refs.map(({ ref, text }, i) => (
            <Text key={`ref-${i}`} color={REF_COLOR[ref.kind]} bold={ref.kind === 'head'}>{text}</Text>
          ))}
          {drawLit(Text, cut(commit.subject, room), query, { dimColor: (isMerge || commit.kind === 'worktree') && !isSelected && query === '', italic: commit.kind === 'worktree', bold: isSelected })}
        </Text>
      </Box>
      {showMeta && (
        <Box width={AUTHOR_WIDTH + 1} flexShrink={0} marginLeft={1}>
          <Text dimColor wrap="truncate-end">{drawLit(Text, commit.author, query, {})}</Text>
        </Box>
      )}
      {showMeta && (
        <Box width={DATE_WIDTH + 1} flexShrink={0}>
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
  pending: Pending | null, graph: Graph, graphWidth: number
) {
  const { Box, Button, Text } = ui
  const armed = (action: Pending['action']) => pending?.action === action && pending.hash === commit.hash
  const target = checkoutTarget(commit)
  const isHead = commit.refs.some(ref => ref.kind === 'head')
  const isWorktree = commit.kind === 'worktree'

  return (
    <Box key={`detail-${commit.hash}`} flexDirection="column" marginLeft={graphWidth} marginTop={1} marginBottom={1} borderStyle="round" borderColor="gray" paddingX={1}>
      <Text color="yellow" wrap="truncate-end">{isWorktree ? 'Uncommitted Changes' : commit.hash}</Text>
      {isWorktree
        ? (
          <Box flexDirection="row" columnGap={2} flexWrap="wrap">
            <Button key="commit" label="✎ commit…" plain onPress={() => commitChanges($)} />
          </Box>
          )
        : (
          <Box flexDirection="row" columnGap={2} flexWrap="wrap">
            <Button key="copy" label="⧉ copy hash" plain onPress={() => copyHash($, commit.hash)} />
            {!isHead && (
              <Button key="checkout" label={armed('checkout') ? `confirm: checkout ${target.label}?` : '⎇ checkout'} plain dimColor={!armed('checkout')} onPress={() => arm($, 'checkout', commit.hash)} />
            )}
            <Button key="branch" label="+ new branch here" plain dimColor onPress={() => newBranch($, commit)} />
            {!isHead && commit.parents.length === 1 && (
              <Button key="pick" label={armed('cherry-pick') ? `confirm: cherry-pick onto ${graph.branch}?` : '⇣ cherry-pick'} plain dimColor={!armed('cherry-pick')} onPress={() => arm($, 'cherry-pick', commit.hash)} />
            )}
          </Box>
          )}
      <Text> </Text>
      {!detail || detail.isLoading
        ? <Text dimColor>Loading…</Text>
        : drawDetailBody(ui, $, detail, diff)}
    </Box>
  )
}

function drawDetailBody (ui: Ui, $: Engine, detail: NonNullable<Detail>, diff: Diff) {
  const { Box, Text } = ui
  return (
    <Box flexDirection="column">
      <Text dimColor wrap="truncate-end">{detail.meta}</Text>
      {detail.message !== '' && <Text> </Text>}
      {detail.message !== '' && detail.message.split('\n').map((line, i) => <Text key={`line-${i}`} wrap="truncate-end">{line || ' '}</Text>)}
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
