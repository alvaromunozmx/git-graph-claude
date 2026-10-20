/**
 * One cell of the graph column: a glyph and the lane it belongs to. A commit's own cell also
 * says whether its lane comes from above (a child waits for it) and goes on below (a parent).
 * `across` is the lane of a horizontal line that passes through a cell drawing something else.
 */
export type Cell = { ch: string; lane: number; up?: boolean; down?: boolean; across?: number }

export type Ref = { name: string; kind: 'head' | 'local' | 'remote' | 'tag' }

export type Commit = {
  hash: string
  parents: string[]
  refs: Ref[]
  author: string
  date: string
  subject: string
  cells: Cell[]
  /** A row that is no commit on a branch: the working tree's uncommitted changes, or a stash */
  kind?: 'worktree' | 'stash'
  /** A stash's name, `stash@{0}` */
  stash?: string
}

/**
 * A file a commit (or the working tree) changed: A, M, D, R, C, T or ? (untracked), with the
 * lines it added and deleted, when they are known; a binary file has no lines.
 */
export type FileChange = { status: string; path: string; oldPath?: string; added?: number; deleted?: number; isBinary?: true }

/** Where the repo's first remote lives on the web, for links to its commits and issues. */
export type Forge = { base: string; host: string; kind: 'github' | 'gitlab' | 'bitbucket' | 'other' }

export type Graph = {
  commits: Commit[]
  branch: string
  /** Files with uncommitted changes */
  changes: FileChange[]
  /** Local branches, then remote ones, for the branch picker */
  branches: string[]
  /** The repo's remotes, `origin` first when there is one */
  remotes: string[]
  /** The commit HEAD points at, or '' in a repo with no commit */
  head: string
  /** The first remote's web address, when it has one */
  forge: Forge | null
  error: string | null
  loadedAt: number
}

/**
 * The open commit: who and when, its message, and the files it changed; or, while a compare is
 * on, the files that changed from the older of the two commits to the newer.
 */
export type Detail = { hash: string; meta: string; message: string; files: FileChange[]; isLoading?: boolean; compare?: { from: string; to: string } } | null

/** One file's diff, opened under it in the commit's detail: unified-diff hunks, or why there are none. */
export type Diff = { hash: string; path: string; hunks: string; note?: string; isLoading?: boolean } | null

/** An action on a commit that changes the repo: it waits for a confirming click. */
export type CommitAction = 'checkout' | 'cherry-pick' | 'revert' | 'merge' | 'rebase' | 'reset'

/** How far `reset` goes: the branch only, also the index, or also the working tree. */
export type ResetMode = 'soft' | 'mixed' | 'hard'

/** An action on a branch or tag badge that changes the repo or a remote: it waits for a confirming click. */
export type RefAction = 'checkout-ref' | 'merge-ref' | 'rebase-ref' | 'delete-branch' | 'force-delete-branch' | 'delete-remote-branch' | 'delete-tag' | 'push-ref'

/** An action on a stash that loses it: it waits for a confirming click. */
export type StashAction = 'stash-pop' | 'stash-drop'

/** An action waiting for its confirming click: on a commit or stash (its hash) or on a ref (its name). */
export type Pending = { action: CommitAction | RefAction | StashAction; hash: string }

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
      /** The settings row under the header is open */
      settingsOpen: boolean
      /** Desktop draws the lanes as curves (SVG) instead of box-drawing glyphs */
      curves: boolean
      /** Each author has an avatar: their initials on their own color */
      avatars: boolean
      /** Merge commits are drawn dim */
      muteMerges: boolean
      /** Commits HEAD does not reach are drawn dim */
      muteOthers: boolean
      pending: Pending | null
      note: Note | null
      /** The branch or tag badge whose actions are open */
      ref: Ref | null
      /** The branch whose rename field is open */
      renaming: string | null
      /** What a stash field is open for: stashing the changes, or a branch from a stash (its hash) */
      stashing: string | null
      /** The commit marked to compare others with */
      compareBase: string | null
      /** The commit whose tag field is open */
      tagging: string | null
      /** What the find field holds: rows that match it are the only ones drawn */
      query: string
    }
  }
}
