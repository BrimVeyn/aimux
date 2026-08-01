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

| Key               | Does                                                                           |
| ----------------- | ------------------------------------------------------------------------------ |
| `/`               | Search every setting, whatever section it is in                                |
| `h` / `←`         | Go to the section list                                                         |
| `l` / `→`         | Go to the settings of the current section                                      |
| `j` / `k`         | Move down / up, in whichever column has the cursor                             |
| `Space` / `Enter` | Change it: flip a checkbox, take the next option, ask for a number or a string |
| `-` / `+`         | Step a number down / up                                                        |
| `r`               | Put the setting back to its default                                            |
| `Esc`             | Close the screen                                                               |
| `?`               | The keybindings for this screen                                                |

`h` and `l` always change column, never the value — a number row would otherwise
make them ambiguous.

Every setting carries its explanation under its label, at all times rather than
only when selected: a row that grows a line when you land on it shifts everything
below, and the list moves under the cursor the whole way down.

All of it works with the mouse. Clicking a section selects it; clicking a setting
selects **and** changes it, because a checkbox you have to select first and click
again is not a checkbox.

On a number, `-` and `+` step by one increment and stop at the ends;
`Space`/`Enter` asks for the number instead, because stepping to the far end of a
wide range takes dozens of presses. A number outside the range is clamped rather
than refused, and says so.

## Searching, and going back

`/` opens a list of every setting, filtered as you type — by label, by what it
does, by the section it is in, or by the key it has in `aimux.json`. `Enter` takes
the screen to it, and so does clicking one.

`r` puts a setting back to what it would be if this screen had never touched it:
its value in your config file if that file declares one, else the built-in
default. A setting you have changed says which value that is, so `r` is not a key
you press to find out what it does. The mark to the left of a label says where its value comes from — `~`
means "you set this here, `r` undoes it", `*` means "your config file owns this".
Settings that are a view over something else (bar widths, the theme, the launch
commands) have neither mark and nothing to reset: their value lives with the thing
that owns it.

A toggle reads `●` when it is on and `○` when it is off, lit or muted to match.
Both are one cell wide in a Latin-width terminal.

The settings themselves are held to a share of the window rather than stretched
across it, so a value stays next to the label it belongs to instead of drifting to
the far edge of a wide terminal.

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

## Notification sound

The **Notifications** section has one **Sound**, played when an assistant asks
you something and when one finishes a turn — never for the tab you are looking
at. `off` is one of its values, so that row is also the off switch. **Volume**
is a percentage of the file's own level, defaulting well under full because
this plays a foot from your ears; `aplay` and Windows ignore it and use the
system volume. **Test sound** plays the current selection at the current
volume, which is how you find out this machine has no audio player before a
notification you cared about goes silent.

Beside the three shipped sounds, the row lists every audio file in
`~/.config/aimux/<profile>/sounds/` by its filename — drop yours in there and it
is offered at the next launch. See
[`runtime-paths.md`](../reference/runtime-paths.md#files-under-the-active-profile-directory).

## When `aimux.config.ts` also sets it

`aimux.config.ts` is read at every launch, and it wins.

So a setting your config file declares shows a `*`, and says "set in
aimux.config.ts — comes back on restart" under its label. You can still change it
here and the change takes effect immediately; the next launch reads your config
file again and puts its value back. If you want the change to last, change it in
the file.

This is what the `initial*` field names in the config have always described:
a startup value, reapplied on each launch.

If a save fails — a read-only config directory, a full disk — you get a toast
saying so, rather than a key that silently does nothing.

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
- `backends`, `sidebar.widgets` — lists
- `externalEditor.args` and `externalEditor.terminal` — argv templates
- `statusBar.aiUsage.tools` — a list

Snippets and themes each have a picker that does the job better than a list of rows
would — filtering as you type, previewing as you move. The screen opens those
rather than reproducing them, and they come back to it when they close.
