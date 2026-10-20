# Changelog

Every version of Git Graph for Claude Code, newest first. Each release on GitHub carries its section as its notes.

## 0.3.35 — 2026-10-20

- **Fixed:** The forge's web address is built without a template, and the signature's key is called its fingerprint, so neither reads as a credential to the directory's scan
- **Docs:** The README says the plugin reads no credentials
- **Docs:** The README's screenshots and GIFs moved to the `assets` branch: installing the plugin no longer downloads 11 MB of pictures

## 0.3.34 — 2026-10-20

- **Fixed:** Copying to the clipboard runs the clipboard program itself, with the text on standard input: no shell, no environment variable
- **Added:** An icon for the plugin directory listing
- **Docs:** The README quotes the prompts the pane sends Claude and says what each hook does
- **Docs:** The uncommitted changes screenshot with the new header and a diff open
- **Docs:** Requirements, and what to check when /git-graph doesn't appear
- **Docs:** Four short GIFs of the pane in the README
- **Docs:** Requirements for mods as Claude Code ships them now, and what the plugin runs and sends

## 0.3.33 — 2026-10-20

- **Fixed:** The uncommitted row's button is as wide as a hash

## 0.3.32 — 2026-10-20

- **Fixed:** The terminal gives a panel's web link a line of its own
- **Docs:** Show the pane in the Claude Code terminal
- **Docs:** A License section in the README that links the MIT license

## 0.3.31 — 2026-10-20

- **Fixed:** Find and the walk share one line in the terminal
- **Docs:** README screenshots of the new header, a branch and the settings
- **Tests:** Find the hover cards by what they say

## 0.3.30 — 2026-10-20

- **Added:** Header in two lines: status and view, then find and walk
- **Added:** Header buttons say what they do; avatars apart from the author

## 0.3.29 — 2026-10-20

- **Added:** A cleaner header, settings in groups, keys on the header
- **Docs:** Show uncommitted changes and a commit opened in the README
- **Docs:** Pixelate the email in the commit screenshot

## 0.3.28 — 2026-10-20

- **Fixed:** Rows come a page at a time, so the pane keeps responding

## 0.3.27 — 2026-10-19

- **Added:** Panels with a title line and grouped action buttons

## 0.3.26 — 2026-10-19

- **Added:** Local and remote branches apart, pull to the upstream

## 0.3.25 — 2026-10-19

- **Docs:** Add screenshot to README and fix the Desktop install
- **Tests:** Run the pane's git commands against real repos

## 0.3.24 — 2026-10-19

- **Fixed:** Lanes go on beside an open commit or badge

## 0.3.23 — 2026-10-19

- **Fixed:** Desktop draws the lane curves

## 0.3.22 — 2026-10-19

- **Fixed:** Curves by default where the surface draws SVG

## 0.3.21 — 2026-10-19

- **Added:** Commit signatures in the detail

## 0.3.20 — 2026-10-19

- **Added:** Pull request links on branch badges

## 0.3.19 — 2026-10-19

- **Added:** Column toggles, date formats and kept settings

## 0.3.18 — 2026-10-19

- **Added:** Repo picker for submodules

## 0.3.17 — 2026-10-19

- **Fixed:** Lines pass through the joins and forks in their way

## 0.3.16 — 2026-10-19

- **Fixed:** A fork never takes a lane that ends in the same row

## 0.3.15 — 2026-10-19

- **Added:** Author avatars

## 0.3.14 — 2026-10-19

- **Added:** Lanes drawn as SVG curves on desktop

## 0.3.13 — 2026-10-19

- **Added:** Issue and web links in commit messages

## 0.3.12 — 2026-10-19

- **Added:** Settings row to dim merges and commits HEAD does not reach

## 0.3.11 — 2026-10-19

- **Added:** Keyboard navigation

## 0.3.10 — 2026-10-19

- **Added:** Lines added and deleted per file

## 0.3.9 — 2026-10-19

- **Added:** Compare two commits

## 0.3.8 — 2026-10-19

- **Added:** Stashes in the graph

## 0.3.7 — 2026-10-19

- **Added:** Fetch every remote from the header

## 0.3.6 — 2026-10-19

- **Added:** Actions on branch and tag badges

## 0.3.5 — 2026-10-19

- **Added:** Revert, tag, merge, rebase and reset from a commit

## 0.3.4 — 2026-10-19

- **Added:** Branch picker to draw one branch alone

## 0.3.3 — 2026-10-19

- **Added:** Find commits by message, author, hash or ref

## 0.3.2 — 2026-10-19

- **Added:** File diffs in the commit detail

## 0.3.1 — 2026-10-19

- **Added:** Uncommitted changes row above HEAD

## 0.2.2 — 2026-10-19

- **Fixed:** Make hooks/ pass a strict type check
- **Tests:** Keep Node lane tests out of claude plugin test, add mod tests

## 0.2.1 — 2026-10-19

- **Fixed:** Name each state reference literally so the plugin loads

## 0.2.0 — 2026-10-19

- **Added:** The first release: the git-graph pane for Claude Code
