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
- **⌕ find** keeps only the commits whose message, author, hash or branch and tag names hold the text, lit where they match. **✕ clear** shows them all again.
- **Uncommitted Changes** get a row of their own (○) above the commit they would follow. Click its `*` to list the changed files; **✎ commit…** has Claude propose a message and commit them, and **⊟ stash…** stashes them, untracked files included, with an optional message.
- **Stashes** (◈) fork off the commit they were made on, while every branch is drawn. Open one to **apply** it, **pop** it, make a **branch…** from it or **drop** it.
- **⚙** opens the settings row: **spaced / compact** lanes (with a gap, or side by side), and which commits are drawn dim: **merge commits** (on by default, like Git Graph) and **commits HEAD does not reach**.
- **The branch picker** shows every branch, only the current one, or any one local or remote branch alone (also `/git-graph all` and `/git-graph current`). Where the surface has no picker, a button toggles all and current.
- **⇣ fetch** fetches every remote, with its tags, pruning the branches deleted there.
- **↻** reloads. The graph also reloads on its own whenever Claude finishes a turn.
- **Keys**, while the pane has the focus: `j` and `k` open the next and the previous commit, `h` the one HEAD points at, `s` goes to the find field, `f` fetches, `r` reloads, `Esc` closes the pane. Tab and the arrows walk the buttons.
- **Click a branch or tag badge** to open its actions under the row:
  - a branch: **checkout**, **merge into current**, **rebase current onto this**, **rename…**, **push** (setting its upstream), **delete** (asking again before it deletes unmerged commits), **copy name**; the current branch also **pull**s (fast-forward only).
  - a remote branch: **checkout** (a local branch tracking it), **merge into current**, **rebase current onto this**, **fetch**, **delete on remote**.
  - a tag: **checkout** (detached), **merge into current**, **push tag**, **delete tag**.
- **Click a hash** to open the commit under its row: full hash, author, date, message, changed files and these actions. Each file shows its status (A, M, D, R) and the lines it added and deleted, and the commit its totals. **Click a file** to read its diff right there (merges against their first parent), and again to close it:
  - **↗ github.com** (or gitlab.com, bitbucket.org) opens the commit's page. In the message, `#123` links to that issue or pull request and web addresses are links.
  - **⇄ compare…** marks it; every commit opened next lists the files that changed between the two, older to newer, each with its diff (the uncommitted row compares too). **✕ stop comparing** in the header ends it.
  - **copy hash** and **copy subject** to the clipboard.
  - **checkout**: its local branch; or a new local branch tracking its remote one; or a detached HEAD.
  - **new branch here**: asks Claude, who asks you for the name and applies its own permissions.
  - **tag…**: opens a field under the commit. `v1.2` makes a lightweight tag, `v1.2: message` an annotated one.
  - **cherry-pick** onto the current branch.
  - **revert**: a new commit that undoes it (a merge against its first parent).
  - **merge into current**: merges its branch, or the commit itself, into the current branch.
  - **rebase current onto this**.
  - **reset current to this**: then pick **soft** (keep the changes staged), **mixed** (keep them unstaged) or **hard** (discard them).

Actions that change the repo need a second click to confirm and wait for Claude to finish its turn. They refuse to run with uncommitted changes, except a soft or mixed reset. A cherry-pick, revert, merge or rebase that stops on a conflict is undone, leaving everything as it was.

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
