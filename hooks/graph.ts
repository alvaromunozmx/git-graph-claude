// The pure part of Git Graph: reading `git log` and laying commits out in lanes.
// Nothing here touches Claude Code, so it can be tested with plain Node.
import type { Cell, Commit, Ref } from '../types'

export const SEP = '\x1f'
export const FORMAT = ['%H', '%P', '%D', '%an', '%ad', '%s'].join('%x1f')

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

/** The cells as plain text, for tests and for the transcript fallback. */
export function draw (commit: Commit): string {
  return commit.cells.map(cell => cell.ch).join('')
}
