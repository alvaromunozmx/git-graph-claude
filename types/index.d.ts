/** One cell of the graph column: a glyph and the lane it belongs to. */
export type Cell = { ch: string; lane: number }

export type Ref = { name: string; kind: 'head' | 'local' | 'remote' | 'tag' }

export type Commit = {
  hash: string
  parents: string[]
  refs: Ref[]
  author: string
  date: string
  subject: string
  cells: Cell[]
  /** A row that is no commit: the working tree's uncommitted changes */
  kind?: 'worktree'
}

/** A file a commit (or the working tree) changed: A, M, D, R, C, T or ? (untracked). */
export type FileChange = { status: string; path: string; oldPath?: string }

export type Graph = {
  commits: Commit[]
  branch: string
  /** Files with uncommitted changes */
  changes: FileChange[]
  error: string | null
  loadedAt: number
}

/** The open commit: who and when, its message, and the files it changed. */
export type Detail = { hash: string; meta: string; message: string; files: FileChange[]; isLoading?: boolean } | null

/** An action waiting for its confirming click. */
export type Pending = { action: 'checkout' | 'cherry-pick'; hash: string }

export type Note = { kind: 'ok' | 'error' | 'info'; text: string }

declare module 'claude-code' {
  interface PluginState {
    'git-graph': {
      graph: Graph | null
      selected: string | null
      detail: Detail
      allBranches: boolean
      shown: number
      compact: boolean
      pending: Pending | null
      note: Note | null
    }
  }
}
