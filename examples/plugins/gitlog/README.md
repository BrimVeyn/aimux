# gitlog

The history of the repository you are working in, full screen: the commit list
on the left, the files the selected commit touched on the right — one line each,
with git's own `+`/`-` bar — each column on half the width.

`<leader>o` opens it — from navigation and from insert, because a history is
something you want while you are typing at an agent, and leaving insert first is
one key too many. Inside: `j`/`k` walk the list, `^d`/`^u` scroll the file list,
`r` reads the log again, `q` or `esc` closes.

The hunks are not here on purpose: `⏎` hands the commit to aimux's own git
mode, which is the screen for reading a diff. Git mode compares the working
tree against `HEAD~N`, so the plugin parks it on the selected commit's parent:
on the newest commit that is exactly its diff, further back it is everything
since it — the same thing `[` and `]` walk to in git mode, reached in one key
from the commit you were reading.

## Why two halves

The UI half cannot know where the repository is: `PluginUiState` carries a
`projectId` and nothing about the filesystem. The daemon half has
`ctx.projects`, and with it the active workspace's `repoRoot` — which for a
worktree is not the directory the workspace runs in. So the daemon runs git and
the UI draws, and they talk over `ctx.rpc`: `log` for the list, `show` for one
commit.

## Configuration

| Key          | Default | What it does                                                   |
| ------------ | ------- | -------------------------------------------------------------- |
| `count`      | 200     | How far back `git log` reads.                                  |
| `showMerges` | true    | Off passes `--no-merges`.                                      |
| `maxLines`   | 500     | Where a very long file list is cut. The pane says when it was. |

Nothing here counts rows: both columns are scrollboxes, so they take the height
they are given and the cursor is kept in view by id rather than by arithmetic.

## What it does not do

It reads. There is no checkout, no revert, no cherry-pick: git mode is aimux's,
and `⏎` is the door to it.
