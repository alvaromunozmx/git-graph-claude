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
}

export type Graph = {
  commits: Commit[]
  branch: string
  /** Files with uncommitted changes */
  dirty: number
  error: string | null
  loadedAt: number
}

export type Detail = { hash: string; text: string } | null

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
