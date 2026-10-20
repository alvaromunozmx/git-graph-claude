// The lane layout, checked against small histories with known shapes.
// Run by Node (`npm run test:node`); named outside *.test.ts so `claude plugin test`, which
// allows only relative and "claude-code" imports, does not load it.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { draw, layout, parseLog, parseNameStatus, parseRefs, parseStatus, SEP, worktreeRow } from '../hooks/graph.ts'

const log = (rows: [string, string, string?][]) =>
  rows.map(([hash, parents, refs = '']) => [hash, parents, refs, 'Alvaro', '19 Oct 2026 10:00', `commit ${hash}`].join(SEP)).join('\n')

test('a straight line stays in one lane', () => {
  const commits = layout(parseLog(log([['c', 'b'], ['b', 'a'], ['a', '']]), new Set()))
  assert.deepEqual(commits.map(draw), ['●', '●', '●'])
})

test('a merge opens a lane and the fork point closes it', () => {
  // m merges f into main; f and b both come from a
  const commits = layout(parseLog(log([['m', 'b f'], ['f', 'a'], ['b', 'a'], ['a', '']]), new Set()))
  assert.deepEqual(commits.map(draw), ['●─╮', '│ ●', '● │', '●─╯'])
})

test('refs are sorted and classified', () => {
  const refs = parseRefs('tag: v1.0, origin/main, HEAD -> main, origin/HEAD, feature/x', new Set(['origin']))
  assert.deepEqual(refs, [
    { name: 'main', kind: 'head' },
    { name: 'feature/x', kind: 'local' },
    { name: 'origin/main', kind: 'remote' },
    { name: 'v1.0', kind: 'tag' }
  ])
})

test('subjects keep the separator if they contain it', () => {
  const [commit] = parseLog(['a', '', '', 'Alvaro', 'today', `one${SEP}two`].join(SEP), new Set())
  assert.equal(commit.subject, `one${SEP}two`)
})

test('status lines become changes, staged status first, renames keep both paths', () => {
  const changes = parseStatus([' M src/a.ts', 'A  src/b.ts', 'R  old.ts -> new.ts', '?? notes.md', 'MM both.ts'].join('\n'))
  assert.deepEqual(changes, [
    { status: 'M', path: 'src/a.ts' },
    { status: 'A', path: 'src/b.ts' },
    { status: 'R', path: 'new.ts', oldPath: 'old.ts' },
    { status: '?', path: 'notes.md' },
    { status: 'M', path: 'both.ts' }
  ])
})

test('name-status lines become changes, renames keep both paths', () => {
  assert.deepEqual(parseNameStatus('M\ta.ts\nR087\told.ts\tnew.ts\nD\tgone.ts\n'), [
    { status: 'M', path: 'a.ts' },
    { status: 'R', path: 'new.ts', oldPath: 'old.ts' },
    { status: 'D', path: 'gone.ts' }
  ])
})

test('the uncommitted row draws its line down to HEAD', () => {
  // HEAD is b, under a newer commit c on another branch
  const commits = parseLog(log([['c', 'a'], ['b', 'a', 'HEAD -> main'], ['a', '']]), new Set())
  commits.unshift(worktreeRow([{ status: 'M', path: 'x' }], 'b'))
  assert.deepEqual(layout(commits).map(draw), ['●', '│ ●', '● │', '●─╯'])
})
