# @brimveyn/aimux-config

Typed configuration package for [`@brimveyn/aimux`](https://github.com/BrimVeyn/aimux).

Use this package to author `aimux.config.ts` or `aimux.config.js` inside an
`aimux` profile directory.

## BREAKING in 0.9.0 — project / workspace / tab

aimux now has one word per level, and each level has its own creation action:

| Level         | What it is                               | Action                         |
| ------------- | ---------------------------------------- | ------------------------------ |
| **project**   | a repository you add by picking a folder | `<C-g>` → "Create new project" |
| **workspace** | a git worktree inside a project          | `<C-p>`                        |
| **tab**       | an assistant in a workspace              | `<C-n>`                        |

What used to be called a workspace is now a **project**; what used to be called
a worktree is now a **workspace**.

**`<C-n>` no longer creates worktrees.** It is an assistant picker; the tab
opens in the active workspace. Use `<C-p>` to create a workspace.

### Renamed actions

The old names still work in 0.9.0 as `@deprecated` aliases and will be removed
in a later release:

| 0.8.x                        | 0.9.0                         |
| ---------------------------- | ----------------------------- |
| `sessionPicker`              | `projectPicker`               |
| `openCreateSessionModal`     | `openCreateProjectModal`      |
| `createSessionEscape`        | `createProjectEscape`         |
| `confirmCreateSession`       | `confirmCreateProject`        |
| `reorderSession`             | `reorderProject`              |
| `switchSessionByIndex`       | `switchProjectByIndex`        |
| `toggleSessionBar`           | `toggleProjectBar`            |
| `openWorktreeMove`           | `openWorkspaceMove`           |
| `toggleWorktreeMoveDelete`   | `toggleWorkspaceMoveDelete`   |
| `confirmWorktreeMove`        | `confirmWorkspaceMove`        |
| `confirmWorktreeDeleteModal` | `confirmWorkspaceDeleteModal` |

### Removed actions

These have no replacement — `<C-n>` cannot create or delete a workspace any
more. A config referencing them fails to compile, on purpose:
`toggleNewTabWorktree`, `deleteSelectedWorktree`, `confirmDeleteWorktree`.

### Renamed mode ids

Mode ids are not aliased; `.mode('modal.create-session', …)` throws.

| 0.8.x                                   | 0.9.0                            |
| --------------------------------------- | -------------------------------- |
| `modal.session-picker.filtering`        | `modal.project-picker.filtering` |
| `modal.session-name`                    | `modal.project-name`             |
| `modal.create-session`                  | `modal.create-project`           |
| `modal.worktree-move`                   | `modal.workspace-move`           |
| `modal.worktree-move-confirm`           | `modal.workspace-move-confirm`   |
| `modal.worktree-delete-confirm`         | `modal.workspace-delete-confirm` |
| `modal.new-tab.worktree-delete-confirm` | _(removed)_                      |
| _(new)_                                 | `modal.create-workspace`         |

### Renamed config key

`worktreeTemplates` is now `workspaceTemplates`. The old key is still read in
0.9.0 and reports a config issue; rename it.

## What This Package Does

`@brimveyn/aimux-config` provides:

- `defineConfig()` for typed config authoring
- the keymap builder API
- the built-in action catalog
- theme helpers and built-in theme IDs
- exported types for config, modes, state, and tooling

It does not launch the app. The `aimux` runtime loads and consumes the resolved
config.

## Install

Install it inside an `aimux` profile directory:

```bash
mkdir -p ~/.config/aimux/default
cd ~/.config/aimux/default
bun init -y
bun add -d @brimveyn/aimux-config
```

Then create:

```text
~/.config/aimux/default/aimux.config.ts
```

If you use another profile, replace `default` with that profile name.

## Minimal Example

```ts
import { defineConfig, actions } from '@brimveyn/aimux-config'

export default defineConfig({
  sessionBar: {
    initialPosition: 'top',
    initialVisible: true,
  },

  keymaps: (k) =>
    k.mode('navigation', (m) => m.map('<C-p>', actions.sessionPicker, 'Workspace picker')),
})
```

This example only uses surfaces that are wired into the runtime today.

Important: typed config expresses startup intent. Fields such as
`sessionBar.initialVisible` or `gitPane.initialMode` are reapplied on every
launch; runtime UI changes do not write back into `aimux.config.ts`.

## Key Notation

| Notation                           | Meaning                    |
| ---------------------------------- | -------------------------- |
| `j`                                | bare character             |
| `J`                                | shifted letter             |
| `<C-n>`                            | Ctrl+N                     |
| `<M-x>` or `<A-x>`                 | Meta or Alt + X            |
| `<C-M-a>`                          | Ctrl+Alt+A                 |
| `<CR>`                             | Enter                      |
| `<Esc>`                            | Escape                     |
| `<Tab>`                            | Tab                        |
| `<BS>`                             | Backspace                  |
| `<Space>`                          | Space                      |
| `<Up>` `<Down>` `<Left>` `<Right>` | arrow keys                 |
| `<leader>`                         | configured leader chord    |
| `dd`                               | multi-key sequence         |
| `<leader>tn`                       | leader, then `t`, then `n` |

Ambiguous prefixes are resolved after the configured timeout.

## Keymap Builder

```ts
k.leader(key)
  .timeout(ms)
  .mode(id | ids[], configure)
```

Mode builder methods:

```ts
m.map(keys, action, description?)
  .unmap(keys)
  .group(prefix, name, configure)
  .passthrough()
```

Example with groups and multi-mode bindings:

```ts
import { defineConfig, actions } from '@brimveyn/aimux-config'

export default defineConfig({
  keymaps: (k) =>
    k
      .mode('navigation', (m) =>
        m
          .group('<leader>t', 'tabs', (g) =>
            g
              .map('n', actions.newTab, 'New tab')
              .map('r', actions.renameTab, 'Rename tab')
              .map('x', actions.closeTab, 'Close tab')
          )
          .unmap('r')
      )
      .mode(['navigation', 'terminal-input'], (m) =>
        m.map('<C-s>', actions.snippetPicker, 'Snippet picker')
      ),
})
```

## Important Runtime Note About the Leader Key

The shipped runtime defaults use `Ctrl+W` as the leader key.

The builder itself starts from `<Space>` internally, but the app merges user
config on top of shipped defaults from `@brimveyn/aimux`. In practice:

- if you omit `.leader(...)`, the shipped leader stays `Ctrl+W`
- if you set another leader such as `<C-a>`, it overrides the shipped leader
- do not rely on `.leader('<Space>')` to switch the runtime leader to Space

See [`../../docs/guide/keymaps.md`](../../docs/guide/keymaps.md) for the full
explanation.

## Actions

Pre-built actions include:

- tabs: `nextTab`, `prevTab`, `newTab`, `renameTab`, `closeTab`, `restartTab`
- workspaces: `sessionPicker`, `switchSessionByIndex(n)` and workspace modal actions
- snippets: `snippetPicker`, snippet editor and filter actions
- themes: `themePicker`, `previewTheme`, `confirmTheme`, `restoreTheme`
- panes: `splitVertical`, `splitHorizontal`, `focusPane`, `resizePane`, `closePane`
- UI: `toggleSidebar`, `toggleSessionBar`, `toggleGitPane`,
  `resizeGitPane(delta)`, `setGitPaneMode(mode)`, `setGitPanePosition(position)`
- modes: `enterInsert`, `leaveTerminalInput`, `closeModal`, `helpModal`
- git: enter git mode, stage, delete or unstage, commit, push

You can also bind a custom `ActionFn` for dynamic behavior.

## Themes

`theme` is a startup override surface, not the persisted selected theme.

Use it to choose the built-in light or dark family when there is no persisted
`aimux.json.themeId`, and to apply palette overrides on top of the chosen base
theme:

```ts
import { defineConfig } from '@brimveyn/aimux-config'

export default defineConfig({
  theme: {
    initialMode: 'dark',
    paletteOverrides: {
      primary: '#7dd3fc',
      warning: '#fbbf24',
    },
  },
})
```

The runtime theme picker persists the selected theme id separately in
`aimux.json`, and that persisted choice wins on restart. See
[`../../docs/guide/themes.md`](../../docs/guide/themes.md) for picker behavior,
palette guidance, and precedence details.

## Support Status

| Surface      | Status             | Notes                                                                                |
| ------------ | ------------------ | ------------------------------------------------------------------------------------ |
| `keymaps`    | Supported          | Fully registered by the runtime                                                      |
| `sessionBar` | Supported          | Startup overrides; app-managed runtime state still persists separately               |
| `gitPane`    | Supported          | Startup overrides for placement and rendering; runtime state persists separately     |
| `theme`      | Supported          | `theme.initialMode` is a startup override; persisted `aimux.json.themeId` still wins |
| `themes`     | Supported          | User themes; appear in the picker and power synthesized highlighting                 |
| `backends`   | Typed surface only | Runtime wiring deferred                                                              |
| `sidebar`    | Ignored            | Superseded by the app-managed `bars` state in `aimux.json`                           |
| `hooks`      | Typed surface only | Type exists, runtime use not currently wired                                         |
| `snippets`   | Typed surface only | Runtime currently uses `aimux-snippets.json`                                         |

## Backends Subpath

The package also exports:

```ts
@brimveyn/aimux-config/backends
```

Current helpers:

- `claudeBackend()`
- `codexBackend()`
- `kimiBackend()`

These helpers are documented as stubs. Do not treat them as a fully supported
runtime backend override system yet.

## More Documentation

- [`../../docs/reference/config-reference.md`](../../docs/reference/config-reference.md)
- [`../../docs/guide/keymaps.md`](../../docs/guide/keymaps.md)
- [`../../docs/guide/themes.md`](../../docs/guide/themes.md)
- [`../../docs/concepts/config-and-state.md`](../../docs/concepts/config-and-state.md)
- [`../../docs/concepts/profiles.md`](../../docs/concepts/profiles.md)

## License

MIT
