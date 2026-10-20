// Every git command that changes the repo or a remote, as the argument vector the pane runs.
// Nothing here runs git: the pane runs these, and test/git.node-test.ts runs the same ones
// against real repos to check what each leaves behind.
import type { Commit, ResetMode } from '../types'

/** A remote branch `origin/feature/x` → its remote and its branch there; the remotes' names decide. */
export function splitRemote (name: string, remotes: string[]) {
  const remote = remotes.find(item => name.startsWith(`${item}/`)) ?? name.slice(0, name.indexOf('/'))
  return { remote, branch: name.slice(remote.length + 1) }
}

/** Checking out a remote branch: the local branch of that name when there is one, else a new one tracking it. */
export function checkoutRemote (name: string, remotes: string[], branches: string[]): string[] {
  const { branch } = splitRemote(name, remotes)
  return branches.includes(branch) ? ['switch', branch] : ['switch', '--track', name]
}

/** Where a checkout of this commit lands: its local branch, its remote one's, or a detached HEAD. */
export function checkoutCommit (commit: Commit, remotes: string[], branches: string[]): { label: string; args: string[] } {
  const local = commit.refs.find(ref => ref.kind === 'local' || (ref.kind === 'head' && ref.name !== 'HEAD'))
  if (local) return { label: local.name, args: ['switch', local.name] }
  const remote = commit.refs.find(ref => ref.kind === 'remote')
  if (remote) {
    const { branch } = splitRemote(remote.name, remotes)
    return branches.includes(branch)
      ? { label: branch, args: ['switch', branch] }
      : { label: `${branch} (tracking ${remote.name})`, args: ['switch', '--track', remote.name] }
  }
  return { label: `${commit.hash.slice(0, 7)} (detached)`, args: ['switch', '--detach', commit.hash] }
}

export const git = {
  cherryPick: (hash: string) => ['cherry-pick', hash],
  /** A merge is reverted against its first parent, the side it was merged into. */
  revert: (hash: string, isMerge: boolean) => ['revert', '--no-edit', ...(isMerge ? ['-m', '1'] : []), hash],
  merge: (target: string) => ['merge', '--no-edit', target],
  rebase: (onto: string) => ['rebase', onto],
  /** What undoes each of the four above when it stops on a conflict. */
  abort: (command: 'cherry-pick' | 'revert' | 'merge' | 'rebase') => [command, '--abort'],
  reset: (mode: ResetMode, hash: string) => ['reset', `--${mode}`, hash],
  /** `message` makes it annotated. */
  tag: (name: string, hash: string, message?: string) => ['tag', ...(message ? ['-a', name, '-m', message] : [name]), hash],
  deleteTag: (name: string) => ['tag', '-d', name],
  pushTag: (remote: string, name: string) => ['push', remote, `refs/tags/${name}`],
  switchTo: (name: string) => ['switch', name],
  detach: (target: string) => ['switch', '--detach', target],
  renameBranch: (from: string, to: string) => ['branch', '-m', from, to],
  /** `-d` refuses a branch with commits merged nowhere; `-D` deletes it anyway. */
  deleteBranch: (name: string, force: boolean) => ['branch', force ? '-D' : '-d', name],
  /** Pushes the branch and makes the remote's its upstream. */
  pushBranch: (remote: string, name: string) => ['push', '-u', remote, name],
  deleteRemoteBranch: (remote: string, branch: string) => ['push', remote, '--delete', branch],
  fetchBranch: (remote: string, branch: string) => ['fetch', remote, branch],
  fetchAll: () => ['fetch', '--all', '--prune', '--tags'],
  /** The checked-out branch moves to its upstream, fast-forward only. */
  pullCurrent: () => ['pull', '--ff-only'],
  /**
   * Another local branch moves to its upstream without being checked out: fetch into it, which
   * git allows only as a fast-forward.
   */
  pullOther: (local: string, upstream: string, remotes: string[]) => {
    const { remote, branch } = splitRemote(upstream, remotes)
    return ['fetch', remote, `${branch}:${local}`]
  },
  stashPush: (message: string) => ['stash', 'push', '--include-untracked', ...(message.trim() ? ['-m', message.trim()] : [])],
  stash: (verb: 'apply' | 'pop' | 'drop', name: string) => ['stash', verb, name],
  stashBranch: (branch: string, name: string) => ['stash', 'branch', branch, name]
}
