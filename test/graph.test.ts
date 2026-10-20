// The lane layout, checked against small histories with known shapes.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { draw, layout, parseLog, parseRefs, SEP } from '../hooks/graph.ts'

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
