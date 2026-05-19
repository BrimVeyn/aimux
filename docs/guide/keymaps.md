---
title: Keymaps
description: Key notation, modes, leader keys, multi-key sequences, help metadata, and override rules.
---

# Keymaps

`aimux` keymaps are defined through `@brimveyn/aimux-config` and resolved at
startup against the shipped defaults.

This page covers the runtime behavior, not just the package API.

## The Shipped Defaults

The default keymap is defined in `packages/aimux-config/src/defaults.ts`.

Important facts:

- shipped leader: `<C-w>`
- shipped timeout: `300`
- defaults exist for `navigation`, `terminal-input`, `git-mode`, and multiple
  modal modes

If you only remember one thing from this page, remember this:

> The runtime default leader is `Ctrl+W`, not `Space`.

## Key Notation

Supported notation includes:

| Notation                           | Meaning                     |
| ---------------------------------- | --------------------------- |
| `j`                                | bare character              |
| `J`                                | shifted letter              |
| `<C-n>`                            | Ctrl+N                      |
| `<M-x>` or `<A-x>`                 | Meta or Alt + X             |
| `<C-M-a>`                          | Ctrl+Alt+A                  |
| `<CR>`                             | Enter                       |
| `<Esc>`                            | Escape                      |
| `<Tab>`                            | Tab                         |
| `<BS>`                             | Backspace                   |
| `<Space>`                          | Space                       |
| `<Up>` `<Down>` `<Left>` `<Right>` | arrow keys                  |
| `<leader>`                         | the configured leader chord |
| `dd`                               | multi-key sequence          |
| `<leader>tn`                       | leader, then `t`, then `n`  |

## Modes

The keymap system works per mode.

The most important modes are:

- `navigation`
- `terminal-input`
- `git-mode`

The runtime also defines modal modes such as:

- `modal.new-tab`
- `modal.new-tab.command-edit`
- `modal.session-picker`
- `modal.session-picker.filtering`
- `modal.create-session`
- `modal.rename-tab`
- `modal.snippet-picker`
- `modal.snippet-picker.filtering`
- `modal.snippet-editor`
- `modal.theme-picker`
- `modal.help`
- `modal.split-picker`
- `modal.git-commit`
- `modal.update-available`

## Builder API

Typical shape:

```ts
import { defineConfig, actions } from '@brimveyn/aimux-config'

export default defineConfig({
  keymaps: (k) =>
    k
      .timeout(300)
      .mode('navigation', (m) =>
        m
          .map('<C-p>', actions.sessionPicker, 'Workspace picker')
          .unmap('r')
          .group('<leader>t', 'tabs', (g) => g.map('n', actions.newTab, 'New tab'))
      )
      .mode(['navigation', 'terminal-input'], (m) =>
        m.map('<C-s>', actions.snippetPicker, 'Snippet picker')
      ),
})
```

Available builder methods:

- `k.leader(key)`
- `k.timeout(ms)`
- `k.mode(id | ids[], configure)`
- `m.map(keys, action, description?)`
- `m.unmap(keys)`
- `m.group(prefix, name, configure)`
- `m.passthrough()`

## Merge Rules

The resolver merges user config on top of shipped defaults.

Important rules:

- user bindings override default bindings with the same key string
- `unmap(keys)` removes default bindings by exact key string
- repeated `.mode()` calls merge into the same mode
- array mode definitions apply the same bindings to every listed mode
- `passthrough()` is OR-merged

## Prefixes and Timeout

The resolver supports multi-key sequences and prefix ambiguity.

Example:

- `d` is a valid binding
- `dd` is also a valid binding

In that case the resolver waits for the configured timeout before deciding
whether the shorter prefix should fire.

Default timeout: `300ms`

## Groups and Descriptions

Descriptions and groups are not cosmetic only.

They power:

- the help modal
- formatted keybinding display
- grouping in the help UI

If a binding has no description, it may be intentionally absent from filtered
help views.

## Runtime Caveat: `Space` Leader

`KeymapBuilder` starts with a builder default leader of `<Space>`, but the
shipped runtime defaults are built with `<C-w>`.

Today, the resolver treats the builder default `<Space>` as "unset" when it
merges user config on top of the shipped defaults. In practice this means:

- if you omit `.leader(...)`, the shipped leader stays `<C-w>`
- if you set another leader such as `<C-a>`, it overrides the shipped leader
- do not rely on `.leader('<Space>')` to switch the runtime leader to Space

Document your own configs accordingly.

## Default Everyday Keys

### `navigation`

- `j` / `k` - next and previous tab
- `J` / `K` - reorder tab right and left
- `i` - focus terminal
- `r` - rename tab
- `dd` - close tab
- `Ctrl+N` - new tab
- `Ctrl+R` - restart tab
- `Ctrl+G` - workspace picker
- `Ctrl+B` - toggle sidebar
- `Ctrl+S` - snippet picker
- `Ctrl+T` - theme picker
- `G` - toggle git panel
- `Ctrl+D` - enter git mode
- `?` - help
- `Ctrl+C` - quit

### `terminal-input`

- `Ctrl+Z` - leave terminal-input mode
- `Ctrl+B` - toggle sidebar
- `Leader+h/j/k/l` - focus panes
- `Leader+H/J/K/L` - resize panes
- `Leader+|` - split vertical
- `Leader+-` - split horizontal
- `Leader+q` - close pane

### Shared between `navigation` and `terminal-input`

- `Leader+b` - toggle workspace bar
- `Leader+1` through `Leader+9` - switch workspaces by index

### `git-mode`

Enter with `Ctrl+D` from `navigation`. Leading action keys:

- `a` - stage the selected entry
- `d` - unstage / delete (two-press confirm on destructive ops)
- `c` - open the commit modal
- `p` - push the current branch
- `v` - toggle split / stacked diff
- `t` - toggle flat / tree list
- `]` / `[` - walk to an older / newer commit baseline (HEAD~N)
- `?` - help (scoped to git-mode, rendered as an overlay)

Navigation and diff scroll keys (`j`/`k`, `Ctrl+N`/`Ctrl+P`, `h`/`l`, arrows,
`Ctrl+D`/`Ctrl+U`, `Backspace`/`Ctrl+H`/`Ctrl+L`) are documented in
[`git-mode.md`](git-mode.md).

## Help Modal

Press `?` in `navigation` mode to open the help modal.

It lists every keybinding with a description, grouped by the mode it applies
to. The view reflects the resolved keymap, so user overrides and removals are
visible there.

Inside the modal:

- `j` / `k`, arrow `Up` / `Down`, or `Ctrl+N` / `Ctrl+P` move the selection
  (selection wraps around at the top and bottom).
- `/` opens a filter field; type to narrow the list by description, mode, keys,
  or group. In filter mode, `Ctrl+N` / `Ctrl+P` and arrow keys still navigate,
  `Esc` returns to the list, and all other keys edit the filter buffer.
- `Esc` closes the modal.

The list is capped at 60% of the terminal height and scrolls only when the
selection leaves the visible window — navigation across mode groups stays
in place visually.

Pressing `?` inside `git-mode` opens a scoped variant of the same modal that
only lists git-mode bindings. It renders as an overlay above the git view
rather than taking over focus, so panel selection, diff scroll, and the
split / stacked toggle stay intact while the modal is visible.

### `modal.snippet-picker.filtering`

The snippet picker is always in filter mode. Plain characters go to the
filter; the special keys below are intercepted:

- `Enter` - paste highlighted snippet into the active terminal
- `Ctrl+A` - paste into every tab in the active group
- `Ctrl+O` - open the snippet's source file in `$EDITOR` (config snippets →
  `aimux.config.ts`; user snippets → `aimux-snippets.json`)
- `Esc` - close the picker

See `snippets.md` for the full picker UX.

### Universal selection alternates

Every picker / modal that supports a selection (new tab, workspace picker,
snippet picker, theme picker, split picker, update-available, help, and their
filter sub-modes) accepts **all** of the following as equivalent prev / next
shortcuts: `j` / `k` (where the mode isn't already bound), arrow `Up` /
`Down`, and `Ctrl+N` / `Ctrl+P`. Use whichever fits your flow — including
inside filter fields that otherwise pass keystrokes through to the buffer.
