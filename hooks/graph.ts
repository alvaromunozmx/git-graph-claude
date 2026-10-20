// The pure part of Git Graph: reading `git log` and laying commits out in lanes.
// Nothing here touches Claude Code, so it can be tested with plain Node.
import type { Cell, Commit, FileChange, Forge, Ref } from '../types'

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

/** `v1.2` or `v1.2: the message`: a tag's name, and a message when it is annotated. */
export function parseTagInput (value: string): { name: string; message?: string } {
  const colon = value.indexOf(':')
  if (colon === -1) return { name: value.trim() }
  const message = value.slice(colon + 1).trim()
  return message === '' ? { name: value.slice(0, colon).trim() } : { name: value.slice(0, colon).trim(), message }
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

/** What `git stash list` is read with: hash, parents, name, author, date, subject. */
export const STASH_FORMAT = ['%H', '%P', '%gd', '%an', '%ad', '%s'].join('%x1f')

/** `git stash list --format=STASH_FORMAT` → one row per stash, leading to the commit it was made on. */
export function parseStashes (stdout: string): Commit[] {
  return stdout.split('\n').filter(line => line.includes(SEP)).map(line => {
    const [hash = '', parents = '', name = '', author = '', date = '', ...subject] = line.split(SEP)
    return { hash, parents: parents.split(' ').slice(0, 1).filter(Boolean), refs: [], author, date, subject: subject.join(SEP), cells: [], kind: 'stash', stash: name }
  })
}

/** Puts each stash just above the commit it was made on, so the layout forks it off there. */
export function withStashes (commits: Commit[], stashes: Commit[]): Commit[] {
  const result = [...commits]
  for (const stash of stashes) {
    const at = result.findIndex(commit => commit.hash === stash.parents[0])
    if (at !== -1) result.splice(at, 0, stash)
  }
  return result
}

/** A numstat path → the file's path now: `src/{a => b}.ts` and `a => b` name the new one. */
function numstatPath (path: string): string {
  const braces = path.match(/^(.*)\{(.*) => (.*)\}(.*)$/)
  if (braces) return `${braces[1]}${braces[3]}${braces[4]}`.replace('//', '/')
  const arrow = path.indexOf(' => ')
  return arrow === -1 ? path : path.slice(arrow + 4)
}

/** `--numstat` → lines added and deleted per path; `-` for both is a binary file. */
export function parseNumstat (stdout: string): Map<string, { added: number; deleted: number } | 'binary'> {
  const stats = new Map<string, { added: number; deleted: number } | 'binary'>()
  for (const line of stdout.split('\n')) {
    const [added = '', deleted = '', ...rest] = line.split('\t')
    if (rest.length === 0) continue
    const path = numstatPath(rest.join('\t'))
    stats.set(path, added === '-' ? 'binary' : { added: Number(added), deleted: Number(deleted) })
  }
  return stats
}

/** The files with their line counts, where the numstat has them. */
export function withStats (files: FileChange[], stats: ReturnType<typeof parseNumstat>): FileChange[] {
  return files.map(file => {
    const stat = stats.get(file.path)
    if (stat === undefined) return file
    return stat === 'binary' ? { ...file, isBinary: true } : { ...file, added: stat.added, deleted: stat.deleted }
  })
}

/** `3 files changed, +40 −12`: the files and the lines they add and delete in all. */
export function summary (files: FileChange[]): string {
  const count = `${files.length} ${files.length === 1 ? 'file' : 'files'} changed`
  const added = files.reduce((sum, file) => sum + (file.added ?? 0), 0)
  const deleted = files.reduce((sum, file) => sum + (file.deleted ?? 0), 0)
  return files.some(file => file.added !== undefined) ? `${count}, +${added} −${deleted}` : count
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
    const isAwaited = col !== -1
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
        // Never a lane that ends in this row: one cell cannot draw a join and a fork at once,
        // and the fork would seem to come from nowhere
        lane = lanes.findIndex((hash, i) => hash === null && i !== col && !joining.includes(i))
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
      cells.push(i === col ? { ch, lane: i, up: isAwaited, down: commit.parents.length > 0 } : { ch, lane: i }, { ch: ' ', lane: i })
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

/** Every commit HEAD reaches through its parents, among the ones loaded. */
export function ancestorsOf (commits: Commit[], head: string): Set<string> {
  const parents = new Map(commits.map(commit => [commit.hash, commit.parents]))
  const reached = new Set<string>()
  const queue = head ? [head] : []
  while (queue.length > 0) {
    const hash = queue.pop() as string
    if (reached.has(hash) || !parents.has(hash)) continue
    reached.add(hash)
    queue.push(...(parents.get(hash) ?? []))
  }
  return reached
}

/** A remote's URL (`git@host:owner/repo.git`, `https://host/owner/repo`, `ssh://…`) → its web address. */
export function forgeOf (url: string): Forge | null {
  const trimmed = url.trim()
  const match = trimmed.match(/^(?:https?|ssh|git):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/) ??
    trimmed.match(/^[\w.-]+@([^:/]+):(.+?)(?:\.git)?\/?$/)
  if (!match) return null
  const host = (match[1] ?? '').toLowerCase()
  const kind = host.includes('github') ? 'github' : host.includes('gitlab') ? 'gitlab' : host.includes('bitbucket') ? 'bitbucket' : 'other'
  return { base: `https://${host}/${match[2]}`, host, kind }
}

/** A commit's page on its forge, where the forge is one whose pages are known. */
export function commitUrl (forge: Forge | null, hash: string): string | null {
  if (!forge || forge.kind === 'other') return null
  return `${forge.base}${forge.kind === 'gitlab' ? '/-/commit/' : forge.kind === 'bitbucket' ? '/commits/' : '/commit/'}${hash}`
}

/** An issue's page (GitHub sends a pull request's number on to it as well). */
export function issueUrl (forge: Forge | null, number: string): string | null {
  if (!forge || forge.kind === 'other') return null
  return `${forge.base}${forge.kind === 'gitlab' ? '/-/issues/' : '/issues/'}${number}`
}

/** A commit message as markdown: its web addresses and `#123` issue numbers become links. */
export function linkify (message: string, forge: Forge | null): string {
  return message.replace(/(https?:\/\/[^\s<>]+[^\s<>.,;:!?)\]'"])|(^|[^\w&/#])#(\d+)\b/gm, (whole, url: string | undefined, before: string | undefined, number: string | undefined) => {
    if (url) return `<${url}>`
    const href = issueUrl(forge, number ?? '')
    return href ? `${before ?? ''}[#${number}](${href})` : whole
  })
}

/** Git Graph's own lane colors, for the curves desktop draws. */
export const CURVE_COLORS = ['#0085d9', '#d9008f', '#00d90a', '#d98500', '#a300d9', '#ff0000', '#00d9cc', '#e138e8']

/** The size of one cell of the curves, in CSS pixels: a desktop row's height, and a lane step. */
export const CURVE_CELL = { width: 8, height: 19 }

/**
 * One row's cells as an SVG of curves, like Git Graph draws: a line per lane, rounded joins
 * and forks, and the commit's dot; hollow for uncommitted changes, a diamond for a stash.
 */
export function curvesOf (cells: Cell[]): string {
  const { width: w, height: h } = CURVE_CELL
  const mid = h / 2
  const parts: string[] = []
  const nodes: string[] = []
  cells.forEach((cell, i) => {
    const color = CURVE_COLORS[cell.lane % CURVE_COLORS.length]
    const x = i * w + w / 2
    const left = i * w
    const right = left + w
    const line = (d: string) => parts.push(`<path d="${d}" stroke="${color}" stroke-width="2" fill="none" stroke-linecap="round"/>`)
    switch (cell.ch) {
      case '│': line(`M${x} 0V${h}`); break
      case '─': line(`M${left} ${mid}H${right}`); break
      case '┼': line(`M${left} ${mid}H${right}`); line(`M${x} 0V${h}`); break
      case '╮': line(`M${left} ${mid}Q${x} ${mid} ${x} ${h}`); break
      case '╭': line(`M${right} ${mid}Q${x} ${mid} ${x} ${h}`); break
      case '╯': line(`M${x} 0Q${x} ${mid} ${left} ${mid}`); break
      case '╰': line(`M${x} 0Q${x} ${mid} ${right} ${mid}`); break
      case '●': case '○': case '◈':
        if (cell.up) line(`M${x} 0V${mid}`)
        if (cell.down) line(`M${x} ${mid}V${h}`)
        nodes.push(cell.ch === '○'
          ? `<circle cx="${x}" cy="${mid}" r="3.5" fill="none" stroke="${color}" stroke-width="1.5" stroke-dasharray="2 1.5"/>`
          : cell.ch === '◈'
            ? `<rect x="${x - 3.5}" y="${mid - 3.5}" width="7" height="7" transform="rotate(45 ${x} ${mid})" fill="${color}"/>`
            : `<circle cx="${x}" cy="${mid}" r="4" fill="${color}"/>`)
        break
    }
  })
  const width = Math.max(1, cells.length) * w
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}">${parts.join('')}${nodes.join('')}</svg>`
}

/** `Alvaro Muñoz` → `AM`; one name gives its first two letters. */
export function initialsOf (name: string): string {
  // Words that start with a letter or digit: `Ana <a@b.c>` is Ana's
  const words = name.trim().split(/[\s._-]+/).filter(word => /^[\p{L}\p{N}]/u.test(word))
  if (words.length === 0) return '?'
  const letters = words.length === 1 ? Array.from(words[0] ?? '').slice(0, 2) : [Array.from(words[0] ?? '')[0], Array.from(words.at(-1) ?? '')[0]]
  return letters.join('').toUpperCase()
}

/** The same author always gets the same color, out of `count`. */
export function colorIndexOf (name: string, count: number): number {
  let hash = 0
  for (const ch of name) hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) >>> 0
  return hash % count
}

/** An author's avatar for the surfaces that draw SVG: initials on a circle of their color. */
export function avatarOf (name: string, size = 16): string {
  const color = CURVE_COLORS[colorIndexOf(name, CURVE_COLORS.length)]
  const text = initialsOf(name).replace(/[<>&"]/g, '')
  const r = size / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${r}" cy="${r}" r="${r}" fill="${color}"/><text x="${r}" y="${r}" dy="0.35em" text-anchor="middle" font-family="system-ui, sans-serif" font-size="${size * 0.45}" font-weight="600" fill="#fff">${text}</text></svg>`
}

/** The cells as plain text, for tests and for the transcript fallback. */
export function draw (commit: Commit): string {
  return commit.cells.map(cell => cell.ch).join('')
}
