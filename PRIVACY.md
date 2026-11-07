# Privacy

Git Graph for Claude Code collects nothing about you and sends nothing to its author or to anyone else.

- **No server, no telemetry, no analytics.** The plugin has no backend and makes no network request of its own.
- **Your repositories stay on your machine.** The pane reads them with `git`, on your computer, and draws them in Claude Code. Nothing it reads leaves your machine, except what the two prompts below carry to Claude.
- **The network is git's, and only when you ask.** **fetch**, **pull**, **push**, **push tag** and **delete on remote** run git against the remotes your repository already has, with the credentials git already uses.
- **Claude sees two prompts, and only when you press their buttons.** **✎ commit…** and **new branch here** send Claude a prompt in your current session, word for word as the [README](README.md#what-it-runs-and-sends) quotes them. Claude handles them like any prompt you type.
- **What it keeps:** your pane settings (lanes, columns, dimming, date format) and, in a folder that holds several repositories, the path of the one you picked last there, in Claude Code's own store on your machine. Nothing about your commits or authors.
- **Links open only when you click them.** The **↗** links to a commit, an issue or a pull request open in your browser, at the address your first remote points to.

Questions: [open an issue](https://github.com/alvaromunozmx/git-graph-claude/issues/new/choose).
