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
  /** Local branches, then remote ones, for the branch picker */
  branches: string[]
  error: string | null
  loadedAt: number
}

/** The open commit: who and when, its message, and the files it changed. */
export type Detail = { hash: string; meta: string; message: string; files: FileChange[]; isLoading?: boolean } | null

/** One file's diff, opened under it in the commit's detail: unified-diff hunks, or why there are none. */
export type Diff = { hash: string; path: string; hunks: string; note?: string; isLoading?: boolean } | null

/** An action on a commit that changes the repo: it waits for a confirming click. */
export type CommitAction = 'checkout' | 'cherry-pick' | 'revert' | 'merge' | 'rebase' | 'reset'

/** How far `reset` goes: the branch only, also the index, or also the working tree. */
export type ResetMode = 'soft' | 'mixed' | 'hard'

/** An action waiting for its confirming click. */
export type Pending = { action: CommitAction; hash: string }

export type Note = { kind: 'ok' | 'error' | 'info'; text: string }

declare module 'claude-code' {
  interface PluginState {
    'git-graph': {
      graph: Graph | null
      selected: string | null
      detail: Detail
      diff: Diff
      allBranches: boolean
      /** One branch to draw alone, picked in the header; null: every branch or the current one */
      branchFilter: string | null
      shown: number
      compact: boolean
      pending: Pending | null
      note: Note | null
      /** The commit whose tag field is open */
      tagging: string | null
      /** What the find field holds: rows that match it are the only ones drawn */
      query: string
    }
  }
}
