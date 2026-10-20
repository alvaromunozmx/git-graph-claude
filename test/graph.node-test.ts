// The lane layout, checked against small histories with known shapes.
// Run by Node (`npm run test:node`); named outside *.test.ts so `claude plugin test`, which
// allows only relative and "claude-code" imports, does not load it.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { ancestorsOf, avatarOf, colorIndexOf, commitUrl, curvesOf, DIFF_LIMIT, draw, forgeOf, initialsOf, linkify, layout, matches, parseBranches, parseDiff, parseLog, parseNameStatus, parseNumstat, parseRefs, parseStashes, parseStatus, parseTagInput, SEP, splitMatch, summary, withStashes, withStats, worktreeRow } from '../hooks/graph.ts'

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

test('a diff keeps its hunks and drops the header before them', () => {
  const stdout = 'diff --git a/x b/x\nindex 1..2 100644\n--- a/x\n+++ b/x\n@@ -1 +1,2 @@\n one\n+two\n'
  assert.deepEqual(parseDiff(stdout), { hunks: '@@ -1 +1,2 @@\n one\n+two' })
})

test('a diff with no hunks says why', () => {
  assert.equal(parseDiff('diff --git a/x b/x\nBinary files a/x and b/x differ\n').note, 'Binary file: no text to compare.')
  assert.equal(parseDiff('diff --git a/x b/x\nold mode 100644\nnew mode 100755\n').note, 'Only the file mode changed.')
  assert.equal(parseDiff('').note, 'No changes to show.')
})

test('a long diff is cut at a hunk boundary', () => {
  const hunk = (n: number) => `@@ -${n} +${n} @@\n-${'a'.repeat(1000)}\n+${'b'.repeat(1000)}`
  const stdout = Array.from({ length: 100 }, (_, i) => hunk(i + 1)).join('\n')
  const { hunks, note } = parseDiff(stdout)
  assert.ok(hunks.length <= DIFF_LIMIT)
  assert.ok(hunks.endsWith('b'.repeat(1000)))
  assert.match(note ?? '', /longer than the pane shows/)
})

test('a commit matches by subject, author, hash prefix or ref, in any case', () => {
  const [commit] = parseLog(log([['abc123', '', 'HEAD -> feature/login']]), new Set())
  for (const query of ['COMMIT ABC', 'alvaro', 'abc1', 'login', '  login  ', '']) assert.ok(matches(commit, query), query)
  for (const query of ['bc12x', 'nope']) assert.ok(!matches(commit, query), query)
})

test('a match splits its text around the lit part', () => {
  assert.deepEqual(splitMatch('Fix the Login form', 'login'), ['Fix the ', 'Login', ' form'])
  assert.deepEqual(splitMatch('Fix it', 'nope'), ['Fix it', '', ''])
})

test('branches list local ones first and leave the remotes HEAD out', () => {
  assert.deepEqual(parseBranches('refs/remotes/origin/HEAD\nrefs/remotes/origin/main\nrefs/heads/main\nrefs/heads/feat/x\n'), ['main', 'feat/x', 'origin/main'])
})

test('a tag field reads a name, and a message after a colon', () => {
  assert.deepEqual(parseTagInput(' v1.2 '), { name: 'v1.2' })
  assert.deepEqual(parseTagInput('v1.2: first release'), { name: 'v1.2', message: 'first release' })
  assert.deepEqual(parseTagInput('v1.2:  '), { name: 'v1.2' })
})

test('a stash forks off the commit it was made on', () => {
  const stashes = parseStashes(['s', 'b i', 'stash@{0}', 'Alvaro', 'today', 'WIP on main'].join(SEP))
  assert.equal(stashes[0]?.stash, 'stash@{0}')
  assert.deepEqual(stashes[0]?.parents, ['b'])
  const commits = withStashes(parseLog(log([['c', 'b'], ['b', 'a'], ['a', '']]), new Set()), stashes)
  assert.deepEqual(commits.map(commit => commit.hash), ['c', 's', 'b', 'a'])
  assert.deepEqual(layout(commits).map(draw), ['●', '│ ●', '●─╯', '●'])
})

test('numstat counts lines per file, renames by their new path, binaries apart', () => {
  const stats = parseNumstat('12\t3\tsrc/a.ts\n-\t-\tlogo.png\n4\t0\tsrc/{old => new}/b.ts\n1\t1\tx.ts => y.ts\n')
  assert.deepEqual(stats.get('src/a.ts'), { added: 12, deleted: 3 })
  assert.equal(stats.get('logo.png'), 'binary')
  assert.deepEqual(stats.get('src/new/b.ts'), { added: 4, deleted: 0 })
  assert.deepEqual(stats.get('y.ts'), { added: 1, deleted: 1 })
  const files = withStats([{ status: 'M', path: 'src/a.ts' }, { status: 'A', path: 'logo.png' }], stats)
  assert.deepEqual(files, [{ status: 'M', path: 'src/a.ts', added: 12, deleted: 3 }, { status: 'A', path: 'logo.png', isBinary: true }])
  assert.equal(summary(files), '2 files changed, +12 −3')
  assert.equal(summary([{ status: 'M', path: 'a' }]), '1 file changed')
})

test('the ancestors of HEAD follow every parent, among the commits loaded', () => {
  const commits = parseLog(log([['m', 'b f'], ['x', 'a'], ['f', 'a'], ['b', 'a'], ['a', 'gone']]), new Set())
  assert.deepEqual([...ancestorsOf(commits, 'm')].sort(), ['a', 'b', 'f', 'm'])
  assert.equal(ancestorsOf(commits, '').size, 0)
})

test('remote URLs of every shape point to their web pages', () => {
  assert.deepEqual(forgeOf('git@github.com:o/r.git'), { base: 'https://github.com/o/r', host: 'github.com', kind: 'github' })
  assert.deepEqual(forgeOf('https://gitlab.com/group/sub/r.git'), { base: 'https://gitlab.com/group/sub/r', host: 'gitlab.com', kind: 'gitlab' })
  assert.deepEqual(forgeOf('ssh://git@bitbucket.org:22/o/r'), { base: 'https://bitbucket.org/o/r', host: 'bitbucket.org', kind: 'bitbucket' })
  assert.deepEqual(forgeOf('https://user@git.example.com/o/r/'), { base: 'https://git.example.com/o/r', host: 'git.example.com', kind: 'other' })
  assert.equal(forgeOf('/srv/repos/r.git'), null)
  assert.equal(commitUrl(forgeOf('https://gitlab.com/o/r'), 'abc'), 'https://gitlab.com/o/r/-/commit/abc')
  assert.equal(commitUrl(forgeOf('https://git.example.com/o/r'), 'abc'), null)
})

test('messages link issue numbers and web addresses, and leave the rest', () => {
  const github = forgeOf('git@github.com:o/r.git')
  assert.equal(linkify('Fix #3, see #4.\n#5 at the start', github), 'Fix [#3](https://github.com/o/r/issues/3), see [#4](https://github.com/o/r/issues/4).\n[#5](https://github.com/o/r/issues/5) at the start')
  assert.equal(linkify('Docs at https://x.dev/a?b=1.', github), 'Docs at <https://x.dev/a?b=1>.')
  assert.equal(linkify('color #fff, a&#39;s, path/#2', github), 'color #fff, a&#39;s, path/#2')
  assert.equal(linkify('Fix #3', null), 'Fix #3')
})

test('a commit cell says whether its lane comes from above and goes on below', () => {
  const commits = layout(parseLog(log([['c', 'b'], ['b', 'a'], ['a', '']]), new Set()))
  assert.deepEqual(commits.map(commit => { const node = commit.cells.find(cell => cell.ch === '●'); return [node?.up, node?.down] }), [[false, true], [true, true], [true, false]])
})

test('curves draw a dot per commit, a line per lane and rounded joins', () => {
  const [merge, , , root] = layout(parseLog(log([['m', 'b f'], ['f', 'a'], ['b', 'a'], ['a', '']]), new Set()))
  const svg = curvesOf(merge?.cells ?? [])
  assert.match(svg, /^<svg [^>]*width="24" height="19"/)
  assert.equal(svg.match(/<circle /g)?.length, 1)
  // The fork to the right is a curve down into the new lane, in that lane's color
  assert.match(svg, /<path d="M16 9.5Q20 9.5 20 19" stroke="#d9008f"/)
  // The root's dot has a line above it and none below
  const rootSvg = curvesOf(root?.cells ?? [])
  assert.match(rootSvg, /M4 0V9.5/)
  assert.doesNotMatch(rootSvg, /M4 9.5V19/)
})

test('an author gets initials and always the same color', () => {
  assert.equal(initialsOf('Alvaro Muñoz'), 'AM')
  assert.equal(initialsOf('alvaromunozmx'), 'AL')
  assert.equal(initialsOf('ana.maria.lopez'), 'AL')
  assert.equal(initialsOf('  '), '?')
  assert.equal(colorIndexOf('Ana', 8), colorIndexOf('Ana', 8))
  assert.match(avatarOf('Ana <x>'), /<text [^>]*>AN<\/text>/)
})
