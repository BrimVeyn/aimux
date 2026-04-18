# @brimveyn/aimux-config

Typed configuration package for [`@brimveyn/aimux`](https://github.com/BrimVeyn/aimux).

Use this package to author `aimux.config.ts` or `aimux.config.js` inside an
`aimux` profile directory.

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
    position: 'top',
    visible: true,
  },

  keymaps: (k) =>
    k.mode('navigation', (m) => m.map('<C-p>', actions.sessionPicker, 'Session picker')),
})
```

This example only uses surfaces that are wired into the runtime today.

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
- sessions: `sessionPicker`, `switchSessionByIndex(n)` and session modal actions
- snippets: `snippetPicker`, snippet editor and filter actions
- themes: `themePicker`, `previewTheme`, `confirmTheme`, `restoreTheme`
- panes: `splitVertical`, `splitHorizontal`, `focusPane`, `resizePane`, `closePane`
- UI: `toggleSidebar`, `toggleSessionBar`, `toggleGitPanel`
- modes: `enterInsert`, `leaveTerminalInput`, `closeModal`, `helpModal`
- git: enter git mode, stage, delete or unstage, commit, push

You can also bind a custom `ActionFn` for dynamic behavior.

## Themes

Built-in theme IDs:

- `aimux`
- `dracula`
- `dracula-at-night`
- `everforest`
- `tokyo-night`
- `gruvbox-dark`
- `catppuccin-mocha`
- `nord`
- `solarized-dark`
- `one-dark`
- `kanagawa`

Helpers:

```ts
themes.extend(baseThemeId, overrides)
themes.create(colors)
```

Typed theme config is currently only `Partially supported` by the runtime.

## Support Status

| Surface      | Status              | Notes                                                                 |
| ------------ | ------------------- | --------------------------------------------------------------------- |
| `keymaps`    | Supported           | Fully registered by the runtime                                       |
| `sessionBar` | Supported           | Used during app initialization                                        |
| `theme`      | Partially supported | Package surface exists, but runtime startup uses `aimux.json.themeId` |
| `backends`   | Typed surface only  | Runtime wiring deferred                                               |
| `sidebar`    | Typed surface only  | Type exists, runtime not currently driven by this field               |
| `hooks`      | Typed surface only  | Type exists, runtime use not currently wired                          |
| `snippets`   | Typed surface only  | Runtime currently uses `aimux-snippets.json`                          |

## Backends Subpath

The package also exports:

```ts
@brimveyn/aimux-config/backends
```

Current helpers:

- `claudeBackend()`
- `codexBackend()`

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
