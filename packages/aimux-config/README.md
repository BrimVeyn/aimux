# @brimveyn/aimux-config

TypeScript configuration API for [aimux](https://github.com/BrimVeyn/aimux) — the terminal multiplexer for AI CLIs.

Write your keymaps, theme, and backends in a typed TypeScript file. Method-chaining builder inspired by nvim, with a prefix-trie resolver that supports leader keys and multi-key sequences.

## Install

```bash
mkdir -p ~/.config/aimux && cd ~/.config/aimux
bun init -y
bun add -d @brimveyn/aimux-config
```

Then create `~/.config/aimux/aimux.config.ts`:

```ts
import { defineConfig, actions, themes } from '@brimveyn/aimux-config'

export default defineConfig({
  theme: themes.extend('tokyo-night', { accent: '#ff9e64' }),

  keymaps: (k) =>
    k
      .leader('<Space>')
      .timeout(300)
      .mode('navigation', (m) =>
        m
          .map('j', actions.nextTab)
          .map('k', actions.prevTab)
          .map('<leader>g', actions.sessionPicker)
          .group('<leader>t', 'tabs', (g) =>
            g.map('n', actions.newTab).map('r', actions.renameTab).map('x', actions.closeTab)
          )
      ),
})
```

## Key notation

| Notation          | Matches                        |
| ----------------- | ------------------------------ |
| `j`               | Bare character `j`             |
| `J`               | Shift+J (uppercase letter)     |
| `<C-n>`           | Ctrl+N                         |
| `<M-x>` / `<A-x>` | Meta/Alt+X                     |
| `<C-M-a>`         | Ctrl+Alt+A                     |
| `<CR>`            | Return/Enter                   |
| `<Esc>`           | Escape                         |
| `<Space>`         | Spacebar                       |
| `<Tab>`           | Tab                            |
| `<BS>`            | Backspace                      |
| `<Up>` `<Down>`   | Arrow keys                     |
| `<leader>`        | Configured leader chord        |
| `dd`              | Multi-key sequence (d, then d) |
| `<leader>tn`      | Leader, then t, then n         |

Ambiguous prefixes (e.g., `d` is bound AND `dd` is bound) are resolved after a configurable timeout (default 300ms).

## Builder API

### Top-level config

```ts
defineConfig({
  theme?: ThemeId | ThemeDefinition
  keymaps?: (k: KeymapBuilder) => KeymapBuilder
  backends?: Record<string, BackendConfig>   // stub for future use
  sidebar?: SidebarConfig                    // stub
  hooks?: HooksConfig                        // stub
  snippets?: SnippetDef[]                    // stub
})
```

### Keymap builder

```ts
k.leader(keys) // default: '<Space>'
  .timeout(ms) // default: 300
  .mode(id | ids[], configure) // define bindings for a mode (or several at once)
```

Pass an array of `ModeId`s to register the same bindings in every listed mode — handy for actions that should fire in both `navigation` and `terminal-input`, for example:

```ts
k.mode(['navigation', 'terminal-input'], (m) => m.map('<C-s>', actions.snippetPicker))
```

### Mode builder

```ts
m.map(keys, action) // bind a key/sequence to an action
  .unmap(keys) // remove a default binding
  .group(prefix, name, g) // sugar for leader-prefixed sub-trees
  .passthrough() // for text-input modes: unmatched keys route to text input
```

### Groups

Groups organize leader-key sub-trees. `.group('<leader>t', 'tabs', g => g.map('n', ...))` is sugar for `.map('<leader>tn', ...)` with a `name` label used by the help modal.

```ts
.group('<leader>t', 'tabs', (g) => g
  .map('n', actions.newTab)
  .map('r', actions.renameTab)
  .map('x', actions.closeTab))
```

## Actions

Pre-built actions cover every built-in aimux operation:

**Tab control** — `nextTab`, `prevTab`, `newTab`, `renameTab`, `closeTab`, `restartTab`, `moveTab(n)`, `reorderTab(n)`

**Modals** — `sessionPicker`, `snippetPicker`, `themePicker`, `helpModal`, `closeModal`

**Sidebar / panels** — `toggleSidebar`, `resizeSidebar(n)`, `toggleGitPanel`, `resizeGitPanel(n)`

**Layout / splits** — `splitVertical`, `splitHorizontal`, `focusPane('left'|'right'|'up'|'down')`, `resizePane(n, 'horizontal'|'vertical')`, `closePane`

**Mode transitions** — `enterInsert`, `enterLayoutMode`, `leaveTerminalInput`, `quit`

**Custom actions** — write an `ActionFn` for dynamic logic:

```ts
.mode('navigation', (m) => m
  .map('gT', (ctx) => {
    const tabId = ctx.state.activeTabId
    if (!tabId) return null
    return {
      actions: [{ type: 'close-active-tab' }],
      effects: [{ type: 'close-tab', tabId }],
    }
  }))
```

## Themes

```ts
import { themes } from '@brimveyn/aimux-config'

// Extend a built-in theme
themes.extend('tokyo-night', {
  accent: '#ff9e64',
  background: '#1a1b26',
})

// Create a custom theme
themes.create({
  accent: '#...',
  accentAlt: '#...',
  background: '#...',
  // ... all ThemeColors keys required
})
```

Built-in themes: `aimux`, `tokyo-night`, `dracula`, `dracula-at-night`, `everforest`, `gruvbox-dark`, `catppuccin-mocha`, `nord`, `solarized-dark`, `one-dark`, `kanagawa`.

## License

MIT
