// The pure part of Git Graph: reading `git log` and laying commits out in lanes.
// Nothing here touches Claude Code, so it can be tested with plain Node.
import type { Cell, Commit, FileChange, Ref } from '../types'

export const SEP = '\x1f'
export const FORMAT = ['%H', '%P', '%D', '%an', '%ad', '%s'].join('%x1f')
/** The hash of the row that stands for the working tree's uncommitted changes. */
export const WORKTREE = 'worktree'

/** `git status --porcelain=v1 -uall` → one change per file, the staged status first. */
export function parseStatus (stdout: string): FileChange[] {
  return stdout.split('\n').filter(line => line.length > 3).map(line => {
    const [x = ' ', y = ' '] = line
    const rest = line.slice(3)
    const status = x === '?' ? '?' : x !== ' ' ? x : y
    const arrow = rest.indexOf(' -> ')
    return (status === 'R' || status === 'C') && arrow !== -1
      ? { status, path: rest.slice(arrow + 4), oldPath: rest.slice(0, arrow) }
      : { status, path: rest }
  })
}

/** `git diff-tree --name-status` → one change per file; `R100 old new` keeps both paths. */
export function parseNameStatus (stdout: string): FileChange[] {
  return stdout.split('\n').filter(Boolean).map(line => {
    const [code = '', first = '', second] = line.split('\t')
    const status = code.charAt(0)
    return second !== undefined ? { status, path: second, oldPath: first } : { status, path: first }
  })
}

/** `git for-each-ref --format=%(refname)` → branch names, local first; the remotes' HEAD left out. */
export function parseBranches (stdout: string): string[] {
  const local: string[] = []
  const remote: string[] = []
  for (const ref of stdout.split('\n').map(line => line.trim()).filter(Boolean)) {
    if (ref.startsWith('refs/heads/')) local.push(ref.slice(11))
    else if (ref.startsWith('refs/remotes/') && !ref.endsWith('/HEAD')) remote.push(ref.slice(13))
  }
  return [...local, ...remote]
}

/** Room for one file's diff in the pane: past it, the diff is cut at a hunk. */
export const DIFF_LIMIT = 60000

/**
 * A `git diff` of one file → its hunks, from the first `@@` on, as a diff viewer reads them;
 * `note` says why there are none (binary, mode only) or that the diff was cut.
 */
export function parseDiff (stdout: string): { hunks: string; note?: string } {
  const start = stdout.startsWith('@@') ? 0 : stdout.indexOf('\n@@') + 1
  if (start === 0 && !stdout.startsWith('@@')) {
    if (/^Binary files /m.test(stdout)) return { hunks: '', note: 'Binary file: no text to compare.' }
    return { hunks: '', note: stdout.trim() === '' ? 'No changes to show.' : 'Only the file mode changed.' }
  }
  const hunks = stdout.slice(start).trimEnd()
  if (hunks.length <= DIFF_LIMIT) return { hunks }
  const cut = hunks.lastIndexOf('\n@@', DIFF_LIMIT)
  return { hunks: cut > 0 ? hunks.slice(0, cut) : hunks.slice(0, DIFF_LIMIT), note: `The diff is longer than the pane shows: ${Math.round(hunks.length / 1000)}k characters.` }
}

/** The row that stands for uncommitted changes, drawn above the commit it would follow. */
export function worktreeRow (changes: FileChange[], head: string | null): Commit {
  return {
    hash: WORKTREE,
    parents: head ? [head] : [],
    refs: [],
    author: '',
    date: '',
    subject: `Uncommitted Changes (${changes.length})`,
    cells: [],
    kind: 'worktree'
  }
}

/** `HEAD -> main, origin/main, tag: v1.0` → refs, the checked-out branch first. */
export function parseRefs (decoration: string, remotes: Set<string>): Ref[] {
  const refs: Ref[] = []
  for (const raw of decoration.split(',').map(part => part.trim()).filter(Boolean)) {
    if (raw === 'HEAD') refs.push({ name: 'HEAD', kind: 'head' })
    else if (raw.startsWith('HEAD -> ')) refs.push({ name: raw.slice(8), kind: 'head' })
    else if (raw.startsWith('tag: ')) refs.push({ name: raw.slice(5), kind: 'tag' })
    else if (raw.endsWith('/HEAD')) continue
    else if (remotes.has(raw.split('/')[0] ?? '')) refs.push({ name: raw, kind: 'remote' })
    else refs.push({ name: raw, kind: 'local' })
  }
  const order = { head: 0, local: 1, remote: 2, tag: 3 }
  return refs.sort((a, b) => order[a.kind] - order[b.kind])
}

/** One `git log --format=FORMAT` output → commits, without their graph cells yet. */
export function parseLog (stdout: string, remotes: Set<string>): Commit[] {
  return stdout.split('\n').filter(line => line.includes(SEP)).map(line => {
    const [hash = '', parents = '', decoration = '', author = '', date = '', ...subject] = line.split(SEP)
    return {
      hash,
      parents: parents ? parents.split(' ') : [],
      refs: parseRefs(decoration, remotes),
      author,
      date,
      subject: subject.join(SEP),
      cells: []
    }
  })
}

/**
 * Lays commits (in --topo-order, newest first) out in lanes, like Git Graph does.
 * Each lane waits for the commit it leads to; every row gets two cells per lane: the
 * lane's glyph and the gap after it, which carries the horizontal lines of merges and forks.
 */
export function layout (commits: Commit[]): Commit[] {
  const lanes: (string | null)[] = []

  for (const commit of commits) {
    let col = lanes.indexOf(commit.hash)
    if (col === -1) {
      col = lanes.indexOf(null)
      if (col === -1) col = lanes.length
      lanes[col] = commit.hash
    }

    // Other children's lanes that end here, joining this commit
    const joining = lanes.flatMap((hash, i) => (hash === commit.hash && i !== col ? [i] : []))
    for (const i of joining) lanes[i] = null

    // Where this commit's parents continue: the first in its own lane, the rest in lanes
    // that already wait for them, or in new ones
    lanes[col] = commit.parents[0] ?? null
    const forks: number[] = []
    const opened = new Set<number>()
    for (const parent of commit.parents.slice(1)) {
      let lane = lanes.indexOf(parent)
      if (lane === -1) {
        lane = lanes.findIndex((hash, i) => hash === null && i !== col)
        if (lane === -1) lane = lanes.length
        lanes[lane] = parent
        opened.add(lane)
      }
      forks.push(lane)
    }

    const width = Math.max(lanes.length, col + 1, ...joining.map(i => i + 1))
    const cells: Cell[] = []
    for (let i = 0; i < width; i++) {
      let ch = ' '
      if (i === col) ch = '●'
      else if (joining.includes(i)) ch = i > col ? '╯' : '╰'
      else if (opened.has(i)) ch = i > col ? '╮' : '╭'
      else if (lanes[i] !== null && lanes[i] !== undefined) ch = '│'
      cells.push({ ch, lane: i }, { ch: ' ', lane: i })
    }

    // Horizontal lines from the commit to every lane that joins it or forks from it
    for (const target of [...joining, ...forks]) {
      const [from, to] = target > col ? [2 * col + 1, 2 * target - 1] : [2 * target + 1, 2 * col - 1]
      for (const cell of cells.slice(from, to + 1)) {
        cell.lane = target
        if (cell.ch === ' ') cell.ch = '─'
        else if (cell.ch === '│') cell.ch = '┼'
      }
    }

    while (cells.at(-1)?.ch === ' ') cells.pop()
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop()
    commit.cells = cells
  }

  return commits
}

/** Whether a commit matches what the find field holds: its subject, author, hash or a ref, any case. */
export function matches (commit: Commit, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (needle === '' || commit.kind) return needle === ''
  return commit.hash.startsWith(needle) ||
    commit.subject.toLowerCase().includes(needle) ||
    commit.author.toLowerCase().includes(needle) ||
    commit.refs.some(ref => ref.name.toLowerCase().includes(needle))
}

/** A text cut in three around the first place it holds the query, for drawing that part lit. */
export function splitMatch (text: string, query: string): [string, string, string] {
  const needle = query.trim().toLowerCase()
  const at = needle === '' ? -1 : text.toLowerCase().indexOf(needle)
  return at === -1 ? [text, '', ''] : [text.slice(0, at), text.slice(at, at + needle.length), text.slice(at + needle.length)]
}

/** The cells as plain text, for tests and for the transcript fallback. */
export function draw (commit: Commit): string {
  return commit.cells.map(cell => cell.ch).join('')
}
