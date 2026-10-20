// Git Graph as a Claude Code mod.
//
// - /git-graph opens a pane with the repo's history laid out in lanes, like the VS Code
//   extension: branches, remotes and tags as badges, author, date and hash per commit.
// - Click a hash to open that commit under its row: its files and a row of actions.
// - Actions that change the repo (checkout, cherry-pick) ask for a second click to confirm;
//   "new branch" hands the task to Claude, so it asks for the name and its own permission.
// - The graph reloads after every turn, so commits Claude makes show up on their own.
import { atom, read } from 'claude-code'
import type { EngineInterface, EventOf, Register } from 'claude-code'

import { FORMAT, layout, parseLog } from './graph'
import type { Commit, Graph, Note, Pending, Ref } from '../types'

type Engine = EngineInterface
type RenderOf<C extends string> = Extract<EventOf['ui.render'], { component: C }>

const PANE = 'git-graph'
// Rows drawn at once; "show more" adds another page
const PAGE = 40

const GRAPH_REF = { plugin: 'git-graph', key: 'graph' } as const
const SELECTED_REF = { plugin: 'git-graph', key: 'selected' } as const
const DETAIL_REF = { plugin: 'git-graph', key: 'detail' } as const
const ALL_REF = { plugin: 'git-graph', key: 'allBranches' } as const
const SHOWN_REF = { plugin: 'git-graph', key: 'shown' } as const
const COMPACT_REF = { plugin: 'git-graph', key: 'compact' } as const
const PENDING_REF = { plugin: 'git-graph', key: 'pending' } as const
const NOTE_REF = { plugin: 'git-graph', key: 'note' } as const
const GRAPH = atom(GRAPH_REF, null)
const SELECTED = atom(SELECTED_REF, null)
const DETAIL = atom(DETAIL_REF, null)
const ALL = atom(ALL_REF, true)
const SHOWN = atom(SHOWN_REF, PAGE)
const COMPACT = atom(COMPACT_REF, false)
const PENDING = atom(PENDING_REF, null)
const NOTE = atom(NOTE_REF, null)

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
    if (arg === 'all' || arg === 'current') await $.state.set(ALL_REF, arg === 'all')
    else if (arg !== '') return { text: 'Usage: /git-graph [all | current]' }
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
    return next(e)
  })
}

// ── Reading the repo ───────────────────────────────────────────────────────────

async function git ($: Engine, args: string[]) {
  const cwd = await $.session.cwd()
  const result = await $.process.run(['git', '-C', cwd, ...args])
  if (result.exitCode !== 0) throw new Error((result.stderr || result.stdout).trim() || `git ${args[0]} failed`)
  return result.stdout
}

function reload ($: Engine): Promise<void> {
  // Two turns ending close together share one load
  loading ??= load($).finally(() => { loading = null })
  return loading
}

async function load ($: Engine) {
  const allBranches = await read($, ALL)
  let graph: Graph
  try {
    const [remotes, branch, status, log] = await Promise.all([
      git($, ['remote']),
      git($, ['branch', '--show-current']).catch(() => ''),
      git($, ['status', '--porcelain']).catch(() => ''),
      git($, [
        'log', ...(allBranches ? ['--all'] : []), '--topo-order', `-n${limit}`,
        `--format=${FORMAT}`, '--date=format:%d %b %Y %H:%M'
      ])
    ])
    const commits = layout(parseLog(log, new Set(remotes.split('\n').map(name => name.trim()).filter(Boolean))))
    graph = {
      commits,
      branch: branch.trim() || '(detached HEAD)',
      dirty: status.trim().split('\n').filter(Boolean).length,
      error: null,
      loadedAt: await $.clock.now()
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    graph = { commits: [], branch: '', dirty: 0, error: /not a git repository/i.test(message) ? 'This folder is not a git repository.' : message, loadedAt: await $.clock.now() }
  }
  await $.state.set(GRAPH_REF, graph)

  // A selected commit that is no longer in the graph loses its details
  const selected = await read($, SELECTED)
  if (selected && !graph.commits.some(commit => commit.hash === selected)) await clearSelection($)
}

async function clearSelection ($: Engine) {
  await $.state.set(SELECTED_REF, null)
  await $.state.set(DETAIL_REF, null)
  await $.state.set(PENDING_REF, null)
}

async function select ($: Engine, hash: string) {
  if ((await read($, SELECTED)) === hash) return clearSelection($)
  await $.state.set(SELECTED_REF, hash)
  await $.state.set(PENDING_REF, null)
  await $.state.set(DETAIL_REF, { hash, text: 'Loading…' })
  const text = await git($, ['show', '--stat=100', '--format=%an <%ae> · %ad%n%n%B', '--date=format:%d %b %Y %H:%M', hash])
    .catch(error => `Could not read the commit: ${error instanceof Error ? error.message : String(error)}`)
  if ((await read($, SELECTED)) === hash) await $.state.set(DETAIL_REF, { hash, text: text.trimEnd() })
}

// One function per value: $.state.set only takes a reference named in this file
async function toggleAll ($: Engine) {
  await $.state.set(ALL_REF, !(await read($, ALL)))
  await reload($)
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
    await note($, 'error', (error instanceof Error ? error.message : String(error)).split('\n')[0])
  }
  await reload($)
}

/** Naming a branch needs a conversation: Claude asks, and its own permissions apply. */
async function newBranch ($: Engine, commit: Commit) {
  if (isBusy) return note($, 'error', 'Claude is working: try again when the turn ends')
  const short = commit.hash.slice(0, HASH_WIDTH)
  try {
    const result = await $.prompt.submit({
      text: `Create a new git branch from commit ${short} ("${commit.subject}"). Ask me for the branch name first, and whether to switch to it.`,
      asUser: true
    })
    if (result?.drop) await note($, 'error', String(result.drop))
    else await note($, 'info', `asked Claude for a branch from ${short}`)
  } catch (error) {
    await note($, 'error', error instanceof Error ? error.message : String(error))
  }
}

// ── Drawing ────────────────────────────────────────────────────────────────────

function cut (text: string, width: number) {
  return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`
}

async function drawPane ($: Engine, e: RenderOf<'Pane'>) {
  const { Box, Button, Text } = $.ui.resolve(e)
  const graph = await read($, GRAPH)
  const selected = await read($, SELECTED)
  const detail = await read($, DETAIL)
  const allBranches = await read($, ALL)
  const compact = await read($, COMPACT)
  const pending = await read($, PENDING)
  const lastNote = await read($, NOTE)
  const shown = await read($, SHOWN)
  const columns = Math.max(40, e.props.bodyColumns)

  const header = (
    <Box key="header" flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between">
        <Text wrap="truncate-end">
          <Text color="green">{graph?.branch ? `⎇ ${graph.branch}` : 'Git Graph'}</Text>
          {graph && graph.dirty > 0 && <Text color="yellow">{`  ● ${graph.dirty} uncommitted`}</Text>}
          <Text dimColor>{graph && !graph.error ? `  ·  ${graph.commits.length} commits${graph.commits.length >= limit ? ` (last ${limit})` : ''}` : ''}</Text>
        </Text>
        <Box flexDirection="row" columnGap={2}>
          <Button key="compact" label={compact ? 'compact' : 'spaced'} plain dimColor onPress={() => toggleCompact($)} />
          <Button key="branches" label={allBranches ? 'all branches' : 'current branch'} plain dimColor onPress={() => toggleAll($)} />
          <Button key="reload" label="↻" plain onPress={() => reload($)} />
        </Box>
      </Box>
      {lastNote && <Text color={NOTE_COLOR[lastNote.kind]} wrap="truncate-end">{lastNote.text}</Text>}
    </Box>
  )

  if (!graph) return <Box flexDirection="column">{header}<Text dimColor>Loading…</Text></Box>
  if (graph.error) return <Box flexDirection="column">{header}<Text color="red">{graph.error}</Text></Box>
  if (graph.commits.length === 0) return <Box flexDirection="column">{header}<Text dimColor>No commits yet.</Text></Box>

  const visible = graph.commits.slice(0, shown)
  // Compact drops the gap after every lane: half as wide, the junction glyphs still connect
  const cellsOf = (commit: Commit) => (compact ? commit.cells.filter((_, i) => i % 2 === 0) : commit.cells)
  const graphWidth = Math.max(...visible.map(commit => cellsOf(commit).length)) + 1
  const metaWidth = AUTHOR_WIDTH + DATE_WIDTH + 2
  const showMeta = columns >= graphWidth + metaWidth + HASH_WIDTH + 30
  const textWidth = columns - graphWidth - HASH_WIDTH - 3 - (showMeta ? metaWidth + 1 : 0)

  const rows = []
  for (const commit of visible) {
    const isSelected = commit.hash === selected
    rows.push(drawRow(Box, Button, Text, $, commit, cellsOf(commit), { graphWidth, textWidth, showMeta, isSelected }))
    if (isSelected) rows.push(drawDetail(Box, Button, Text, $, commit, detail?.hash === commit.hash ? detail.text : 'Loading…', pending, graph, graphWidth))
  }

  return (
    <Box flexDirection="column">
      {header}
      <Text> </Text>
      {rows}
      {graph.commits.length > shown && (
        <Button key="more" label={`show ${Math.min(PAGE, graph.commits.length - shown)} more`} plain dimColor onPress={() => $.state.set(SHOWN_REF, shown + PAGE)} />
      )}
    </Box>
  )
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
  { graphWidth, textWidth, showMeta, isSelected }: { graphWidth: number; textWidth: number; showMeta: boolean; isSelected: boolean }
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
          <Text dimColor={isMerge && !isSelected} bold={isSelected}>{cut(commit.subject, room)}</Text>
        </Text>
      </Box>
      {showMeta && (
        <Box width={AUTHOR_WIDTH + 1} flexShrink={0} marginLeft={1}>
          <Text dimColor wrap="truncate-end">{commit.author}</Text>
        </Box>
      )}
      {showMeta && (
        <Box width={DATE_WIDTH + 1} flexShrink={0}>
          <Text dimColor wrap="truncate-end">{commit.date}</Text>
        </Box>
      )}
      <Box width={HASH_WIDTH + 2} flexShrink={0} justifyContent="flex-end">
        <Button key={`hash-${commit.hash}`} label={commit.hash.slice(0, HASH_WIDTH)} plain dimColor={!isSelected} onPress={() => select($, commit.hash)} />
      </Box>
    </Box>
  )
}

/** The open commit, under its own row: actions, then its message and files. */
function drawDetail (
  Box: any, Button: any, Text: any, $: Engine, commit: Commit, text: string,
  pending: Pending | null, graph: Graph, graphWidth: number
) {
  const armed = (action: Pending['action']) => pending?.action === action && pending.hash === commit.hash
  const target = checkoutTarget(commit)
  const isHead = commit.refs.some(ref => ref.kind === 'head')
  const lines = text.split('\n')

  return (
    <Box key={`detail-${commit.hash}`} flexDirection="column" marginLeft={graphWidth} marginTop={1} marginBottom={1} borderStyle="round" borderColor="gray" paddingX={1}>
      <Text color="yellow" wrap="truncate-end">{commit.hash}</Text>
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
      <Text> </Text>
      {lines.map((line, i) => (
        <Text key={`line-${i}`} wrap="truncate-end" dimColor={i === 0}>
          {line || ' '}
        </Text>
      ))}
    </Box>
  )
}
