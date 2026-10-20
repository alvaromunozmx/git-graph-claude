// The pane's git commands, run against real repos: a working repo cloned from a bare remote,
// both in a temporary folder. Each test checks what a command leaves behind, and that what
// the pane reads (log, status, diff-tree, numstat, stash list, refs) parses as git writes it.
// Run by Node (`npm run test:node`).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { checkoutCommit, checkoutRemote, git } from '../hooks/commands.ts'
import { FORMAT, layout, parseBranches, parseLog, parseNameStatus, parseNumstat, parseStashes, parseStatus, STASH_FORMAT } from '../hooks/graph.ts'

const ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GIT_AUTHOR_NAME: 'Ana',
  GIT_AUTHOR_EMAIL: 'ana@example.com',
  GIT_COMMITTER_NAME: 'Ana',
  GIT_COMMITTER_EMAIL: 'ana@example.com',
  GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1'
}

/** git in `cwd`, as the pane runs it: an argument vector, no shell. */
function run (cwd: string, args: string[]) {
  const result = spawnSync('git', ['-C', cwd, '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { env: ENV, encoding: 'utf8' })
  return { code: result.status ?? 1, stdout: result.stdout, stderr: result.stderr }
}

/** git that must succeed; its output. */
function ok (cwd: string, args: string[]) {
  const result = run(cwd, args)
  assert.equal(result.code, 0, `git ${args.join(' ')}: ${result.stderr || result.stdout}`)
  return result.stdout
}

/** Runs an action that can stop on a conflict the way the pane does: a conflict is undone. */
function undoOnConflict (cwd: string, args: string[], abort: string[]) {
  const result = run(cwd, args)
  if (result.code !== 0) run(cwd, abort)
  return result
}

const head = (cwd: string) => ok(cwd, ['rev-parse', 'HEAD']).trim()
const branchOf = (cwd: string) => ok(cwd, ['branch', '--show-current']).trim()
const isClean = (cwd: string) => ok(cwd, ['status', '--porcelain']).trim() === ''

/** A remote with `main` (two commits) and `feature` (one more), cloned into a working repo. */
function repos () {
  const root = mkdtempSync(join(tmpdir(), 'git-graph-'))
  const remote = join(root, 'origin.git')
  const work = join(root, 'work')
  ok(root, ['init', '--bare', remote])
  ok(root, ['clone', remote, work])
  const commit = (file: string, text: string, message: string) => {
    writeFileSync(join(work, file), text)
    ok(work, ['add', file])
    ok(work, ['commit', '-m', message])
    return head(work)
  }
  const base = commit('a.txt', 'one\n', 'first')
  commit('a.txt', 'one\ntwo\n', 'second')
  ok(work, ['push', '-u', 'origin', 'main'])
  ok(work, ['switch', '-c', 'feature'])
  const feature = commit('b.txt', 'feature\n', 'feature work')
  ok(work, ['push', '-u', 'origin', 'feature'])
  ok(work, ['switch', 'main'])
  return { root, remote, work, base, feature, commit, done: () => rmSync(root, { recursive: true, force: true }) }
}

test('what the pane reads parses as real git writes it', () => {
  const r = repos()
  try {
    writeFileSync(join(r.work, 'a.txt'), 'changed\n')
    writeFileSync(join(r.work, 'new.txt'), 'new\n')
    assert.deepEqual(parseStatus(ok(r.work, ['status', '--porcelain=v1', '-uall'])), [
      { status: 'M', path: 'a.txt' },
      { status: '?', path: 'new.txt' }
    ])
    ok(r.work, ['stash', 'push', '--include-untracked', '-m', 'wip'])
    const [stash] = parseStashes(ok(r.work, ['stash', 'list', `--format=${STASH_FORMAT}`, '--date=format:%d %b %Y %H:%M']))
    assert.equal(stash?.stash, 'stash@{0}')
    // Two stashes made in the same minute keep apart: stash@{0} is the newest
    writeFileSync(join(r.work, 'a.txt'), 'again\n')
    ok(r.work, git.stashPush('second'))
    const both = parseStashes(ok(r.work, ['stash', 'list', `--format=${STASH_FORMAT}`, '--date=format:%d %b %Y %H:%M']))
    assert.deepEqual(both.map(item => [item.stash, item.subject]), [['stash@{0}', 'On main: second'], ['stash@{1}', 'On main: wip']])
    ok(r.work, git.stash('drop', 'stash@{0}'))
    assert.equal(stash?.subject, 'On main: wip')
    assert.deepEqual(stash?.parents, [head(r.work)])

    const log = ok(r.work, ['log', '--exclude=refs/stash', '--all', '--topo-order', `--format=${FORMAT}`, '--date=format:%d %b %Y %H:%M', '--'])
    const commits = layout(parseLog(log, new Set(['origin'])))
    assert.deepEqual(commits.map(commit => commit.subject), ['feature work', 'second', 'first'])
    assert.deepEqual(commits[1]?.refs, [{ name: 'main', kind: 'head' }, { name: 'origin/main', kind: 'remote' }])
    assert.deepEqual(parseBranches(ok(r.work, ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes'])), ['feature', 'main', 'origin/feature', 'origin/main'])

    // A rename reads as one change, with its lines counted under its new path
    ok(r.work, ['switch', 'feature'])
    ok(r.work, ['mv', 'b.txt', 'c.txt'])
    ok(r.work, ['commit', '-m', 'rename'])
    const range = [r.feature, head(r.work)]
    assert.deepEqual(parseNameStatus(ok(r.work, ['diff-tree', '-r', '-M', '--name-status', '--no-commit-id', ...range])), [{ status: 'R', path: 'c.txt', oldPath: 'b.txt' }])
    assert.deepEqual(parseNumstat(ok(r.work, ['diff-tree', '-r', '-M', '--numstat', '--no-commit-id', ...range])).get('c.txt'), { added: 0, deleted: 0 })
  } finally {
    r.done()
  }
})

test('checkout: a local branch, a remote one tracked, or the local one it already has', () => {
  const r = repos()
  try {
    ok(r.work, ['branch', '-D', 'feature'])
    const branches = () => parseBranches(ok(r.work, ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes']))
    ok(r.work, checkoutRemote('origin/feature', ['origin'], branches()))
    assert.equal(branchOf(r.work), 'feature')
    assert.equal(ok(r.work, ['rev-parse', '--abbrev-ref', 'feature@{upstream}']).trim(), 'origin/feature')
    ok(r.work, git.switchTo('main'))
    // Checking out a commit that carries origin/feature, now that feature exists here, switches to it
    const target = checkoutCommit({ hash: r.feature, parents: [], refs: [{ name: 'origin/feature', kind: 'remote' }], author: '', date: '', subject: '', cells: [] }, ['origin'], branches())
    assert.deepEqual(target.args, ['switch', 'feature'])
    ok(r.work, target.args)
    assert.equal(branchOf(r.work), 'feature')
    ok(r.work, git.detach(r.base))
    assert.equal(branchOf(r.work), '')
  } finally {
    r.done()
  }
})

test('cherry-pick, revert, merge and rebase do their work, and a conflict is undone', () => {
  const r = repos()
  try {
    const before = head(r.work)
    ok(r.work, git.cherryPick(r.feature))
    assert.equal(ok(r.work, ['log', '-1', '--format=%s']).trim(), 'feature work')
    ok(r.work, git.revert(head(r.work), false))
    assert.match(ok(r.work, ['log', '-1', '--format=%s']).trim(), /^Revert "feature work"/)
    ok(r.work, git.reset('hard', before))

    // A merge that only moves main forward, then a real merge commit, reverted against main
    ok(r.work, git.merge('feature'))
    assert.equal(head(r.work), r.feature)
    ok(r.work, git.reset('hard', before))
    r.commit('a.txt', 'one\ntwo\nthree\n', 'three on main')
    ok(r.work, git.merge('feature'))
    const merge = head(r.work)
    assert.equal(ok(r.work, ['log', '-1', '--format=%P']).trim().split(' ').length, 2)
    ok(r.work, git.revert(merge, true))
    assert.match(ok(r.work, ['log', '-1', '--format=%s']).trim(), /^Revert "Merge branch 'feature'/)

    ok(r.work, git.reset('hard', before))
    ok(r.work, git.switchTo('feature'))
    ok(r.work, git.rebase('main'))
    assert.equal(ok(r.work, ['merge-base', 'feature', 'main']).trim(), before)

    // A conflict: both sides change the same line; the pane undoes it and the repo is as it was
    ok(r.work, git.switchTo('main'))
    const clash = r.commit('b.txt', 'main side\n', 'main touches b')
    const result = undoOnConflict(r.work, git.cherryPick(r.feature), git.abort('cherry-pick'))
    assert.notEqual(result.code, 0)
    assert.match(result.stderr + result.stdout, /conflict/i)
    assert.equal(head(r.work), clash)
    assert.ok(isClean(r.work))
    const merging = undoOnConflict(r.work, git.merge('feature'), git.abort('merge'))
    assert.notEqual(merging.code, 0)
    assert.equal(head(r.work), clash)
    assert.ok(isClean(r.work))
  } finally {
    r.done()
  }
})

test('reset: soft keeps the changes staged, mixed unstaged, hard drops them', () => {
  const r = repos()
  try {
    const top = head(r.work)
    ok(r.work, git.reset('soft', r.base))
    assert.equal(head(r.work), r.base)
    assert.equal(ok(r.work, ['status', '--porcelain']).trim(), 'M  a.txt')
    ok(r.work, git.reset('hard', top))
    ok(r.work, git.reset('mixed', r.base))
    assert.equal(ok(r.work, ['status', '--porcelain']).trim(), 'M a.txt')
    ok(r.work, git.reset('hard', r.base))
    assert.ok(isClean(r.work))
  } finally {
    r.done()
  }
})

test('tags: lightweight or annotated, pushed to the remote and deleted', () => {
  const r = repos()
  try {
    ok(r.work, git.tag('v1', r.base))
    ok(r.work, git.tag('v2', r.base, 'the release'))
    assert.equal(ok(r.work, ['cat-file', '-t', 'v1']).trim(), 'commit')
    assert.equal(ok(r.work, ['cat-file', '-t', 'v2']).trim(), 'tag')
    ok(r.work, git.pushTag('origin', 'v2'))
    assert.match(ok(r.remote, ['tag']), /v2/)
    ok(r.work, git.deleteTag('v1'))
    assert.doesNotMatch(ok(r.work, ['tag']), /v1/)
  } finally {
    r.done()
  }
})

test('branches: rename, push with upstream, delete asking again when unmerged, delete on the remote', () => {
  const r = repos()
  try {
    ok(r.work, ['branch', 'topic', r.feature])
    ok(r.work, git.renameBranch('topic', 'topic-2'))
    assert.match(ok(r.work, ['branch']), /topic-2/)
    // Merged nowhere, not even upstream: -d refuses with the words the pane looks for, -D deletes
    const refused = run(r.work, git.deleteBranch('topic-2', false))
    assert.notEqual(refused.code, 0)
    assert.match(refused.stderr, /not fully merged/i)
    ok(r.work, git.pushBranch('origin', 'topic-2'))
    assert.equal(ok(r.work, ['rev-parse', '--abbrev-ref', 'topic-2@{upstream}']).trim(), 'origin/topic-2')
    // Pushed, it is merged into its upstream: -d deletes it here and leaves it on the remote
    ok(r.work, git.deleteBranch('topic-2', false))
    assert.doesNotMatch(ok(r.work, ['branch']), /topic-2/)
    assert.match(ok(r.remote, ['branch']), /topic-2/)
    ok(r.work, git.deleteRemoteBranch('origin', 'topic-2'))
    assert.doesNotMatch(ok(r.remote, ['branch']), /topic-2/)
  } finally {
    r.done()
  }
})

test('fetch brings a branch, and fetch all prunes the ones deleted on the remote', () => {
  const r = repos()
  try {
    // Another clone pushes to feature and deletes main's twin branch
    const other = join(r.root, 'other')
    ok(r.root, ['clone', r.remote, other])
    ok(other, ['switch', 'feature'])
    writeFileSync(join(other, 'b.txt'), 'more\n')
    ok(other, ['commit', '-am', 'more feature'])
    ok(other, ['push', 'origin', 'feature'])
    ok(r.work, git.fetchBranch('origin', 'feature'))
    assert.equal(ok(r.work, ['rev-parse', 'origin/feature']).trim(), head(other))
    ok(other, ['push', 'origin', '--delete', 'feature'])
    ok(r.work, git.fetchAll())
    assert.doesNotMatch(ok(r.work, ['branch', '-r']), /origin\/feature/)
  } finally {
    r.done()
  }
})

test('stashes: push with untracked files, apply, pop, drop and branch', () => {
  const r = repos()
  try {
    writeFileSync(join(r.work, 'a.txt'), 'changed\n')
    writeFileSync(join(r.work, 'new.txt'), 'new\n')
    ok(r.work, git.stashPush('half done'))
    assert.ok(isClean(r.work))
    assert.match(ok(r.work, ['stash', 'list']), /half done/)
    ok(r.work, git.stash('apply', 'stash@{0}'))
    assert.match(ok(r.work, ['status', '--porcelain', '-uall']), /new\.txt/)
    ok(r.work, git.reset('hard', 'HEAD'))
    ok(r.work, ['clean', '-fd'])
    ok(r.work, git.stash('pop', 'stash@{0}'))
    assert.equal(ok(r.work, ['stash', 'list']).trim(), '')
    ok(r.work, git.stashPush(''))
    ok(r.work, git.stashBranch('rescued', 'stash@{0}'))
    assert.equal(branchOf(r.work), 'rescued')
    assert.match(ok(r.work, ['status', '--porcelain', '-uall']), /a\.txt/)
    ok(r.work, git.stashPush('to drop'))
    ok(r.work, git.stash('drop', 'stash@{0}'))
    assert.equal(ok(r.work, ['stash', 'list']).trim(), '')
  } finally {
    r.done()
  }
})
