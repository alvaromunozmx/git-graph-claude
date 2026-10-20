# Git Graph for Claude Code

A Git Graph pane for Claude Code, in Claude Desktop and in the terminal: your branches, tags and remotes laid out in lanes, like the VS Code extension, next to the conversation.

## Install

```text
/plugin marketplace add alvaromunozmx/git-graph-claude
/plugin install git-graph@git-graph-claude
```

Or, in Claude Desktop, download `git-graph.zip` from the [latest release](https://github.com/alvaromunozmx/git-graph-claude/releases/latest) and upload it in Settings → Plugins → Upload a plugin.

Then run `/reload-plugins` (or start a new session) and `/git-graph`.

## Use

- `/git-graph` opens the pane: commits laid out in lanes, with the checked-out branch, local and remote branches and tags (◆) as badges, plus author, date and hash. It adapts to the pane's width.
- The header shows the current branch and how many files have uncommitted changes.
- **Uncommitted Changes** get a row of their own (○) above the commit they would follow. Click its `*` to list the changed files, and **✎ commit…** to have Claude propose a message and commit them.
- **spaced / compact** switches between lanes with a gap and lanes side by side.
- **all branches / current branch** shows every branch or only the current one (also `/git-graph all` and `/git-graph current`).
- **↻** reloads. The graph also reloads on its own whenever Claude finishes a turn.
- **Click a hash** to open the commit under its row: full hash, author, date, message, changed files and these actions. **Click a file** to read its diff right there (merges against their first parent), and again to close it:
  - **copy hash** to the clipboard.
  - **checkout**: its local branch; or a new local branch tracking its remote one; or a detached HEAD.
  - **new branch here**: asks Claude, who asks you for the name and applies its own permissions.
  - **cherry-pick** onto the current branch. On a conflict it aborts and leaves everything as it was.

Checkout and cherry-pick need a second click to confirm, wait for Claude to finish its turn, and refuse to run with uncommitted changes.

## Settings

`limit`: how many commits to load (150 by default). They are drawn 40 at a time.

## How it works

It is a Claude Code *mod*: [`hooks/register.tsx`](hooks/register.tsx) registers `/git-graph`, opens a pane and draws it, and listens to `turn.complete` to reload. [`hooks/graph.ts`](hooks/graph.ts) reads `git log` and lays commits out in lanes; it does not depend on Claude Code.

## Development

| Command | What it does |
| --- | --- |
| `npm run test:node` | The lane layout's tests, with Node's test runner |
| `npm run validate` | `claude plugin validate .` |
| `npm run test:mod` | `claude plugin test .` |
| `npm run zip` | `dist/git-graph.zip`, ready to upload in Claude Desktop |

To release: `npm version patch` (or `minor`, `major`) bumps `package.json`, `plugin.json` and `marketplace.json` together and tags the commit; `git push --follow-tags` publishes a GitHub release with the zip. Users update with `/plugin marketplace update git-graph-claude`.

MIT © Alvaro Muñoz
