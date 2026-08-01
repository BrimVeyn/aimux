---
title: Settings
description: The in-app settings screen — how to open it, how to move around it, and which file each setting ends up in.
---

# Settings

`<Leader>,` opens the settings screen — or the `⚙ Settings` button at the bottom
of the Projects list. It replaces the whole centre of the window, the way git mode
does: the tab bar and the status bar stay where they are, and `Esc` (or the
`Close` button) puts you back where you were.

Nothing here needs `aimux.config.ts`. That file still works, still wins, and is
still the only way to set a few things (see [What is not
here](#what-is-not-here)) — but it is no longer the price of admission.

## Moving around

Two columns: the sections on the left, that section's settings on the right.

| Key               | Does                                                                         |
| ----------------- | ---------------------------------------------------------------------------- |
| `h` / `←`         | Go to the section list                                                       |
| `l` / `→`         | Go to the settings of the current section                                    |
| `j` / `k`         | Move down / up, in whichever column has the cursor                           |
| `Space` / `Enter` | Change the setting: flip a checkbox, take the next option, open a text field |
| `-` / `+`         | Step a number down / up                                                      |
| `Esc`             | Close the screen                                                             |
| `?`               | The keybindings for this screen                                              |

`h` and `l` always change column, never the value — a number row would otherwise
make them ambiguous.

All of it works with the mouse. Clicking a section selects it; clicking a setting
selects **and** changes it, because a checkbox you have to select first and click
again is not a checkbox.

`Space`/`Enter` on a number steps it up and wraps round at the maximum, so the key
always does something visible. `-` and `+` name a direction, so they stop at the
ends instead of wrapping.

## Where a setting ends up

Two files, and which one gets written depends on the setting:

- Most of them are written to the `settings` block of `aimux.json`, keyed by the
  row's id. Only the settings you have actually touched appear there.
- Some are a view over a value the app already owns and persists elsewhere — bar
  widths, the theme mode, the launch command per assistant. Changing one of those
  from this screen is exactly the same as changing it with its keybinding.

## Setup scripts

The **Setup** section has one row per project, over that project's setup script
(`~/.config/aimux/<profile>/projects/<id>/setup.sh`, the script that runs once in
each new workspace — see [`workspaces.md`](workspaces.md#setup-script)).

Most setup is one command, so most rows are a text field: type
`bun install && cp .env.example .env` and the script is written for you, with the
shebang and `set -euo pipefail` on top and the executable bit set.

A script whose work runs to more than one line is shown but not editable — it
reads `3 lines ›`, and activating it opens your editor. A one-line field cannot
hold a real script, and offering to edit one would mean truncating it the moment
you confirm.

The row re-reads the file as you move around the screen, so a script you changed
in your editor shows its new state when you come back to it.

## When `aimux.config.ts` also sets it

`aimux.config.ts` is read at every launch, and it wins.

So a setting your config file declares shows a `*`, and the row says
"set in aimux.config.ts — comes back on restart" when you land on it. You can
still change it here and the change takes effect immediately; the next launch
reads your config file again and puts its value back. If you want the change to
last, change it in the file.

This is what the `initial*` field names in the config have always described:
a startup value, reapplied on each launch.

**One exception:** the theme id. `Ctrl+T` picks a theme several times in a
session, and having it revert on every restart would be absurd, so the last theme
you picked wins over `theme.initialId`. Every other setting follows the rule
above.

## Experimental

The **Experimental** section holds the config's `theme.beta.*` flags. They are
unfinished: they can change behaviour or go away in any release, which is why they
are grouped under that label rather than filed by what they touch.

## Applies on restart

A few rows say so, because the thing that reads them is set up before this screen
exists:

- **Auto-rename** — its config goes to the session backend at bootstrap.
- **Claude Code hooks** — a one-way write into `~/.claude/settings.json` at
  startup, with no uninstall.
- **Experimental syntax highlight** — an environment variable the PTYs inherit
  when they spawn.

Everything else takes effect as you change it.

## What is not here

Settings whose value is a list or a function have no row, and stay in
`aimux.config.ts`:

- `keymaps` — a function, and a screen of its own later
- `hooks` — a function
- `backends`, `sidebar.widgets`, `snippets` — lists
- `externalEditor.args` and `externalEditor.terminal` — argv templates
- `statusBar.aiUsage.tools` — a list

Snippets have their own editor (`Ctrl+S`) and themes their own picker (`Ctrl+T`);
the settings screen points at both rather than reproducing them badly.
