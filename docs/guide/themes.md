# Themes

aimux themes are [Shiki](https://shiki.style/themes) themes. The in-memory
`theme` object, the object fed to `highlighter.loadTheme(...)` for diff
highlighting, and the object a user drops into `aimux.config.ts` all share one
shape — a VSCode-style theme JSON. No aimux-specific palette aliases, no
translation layer.

aimux ships:

- Two house themes: `aimux` (teal accents on deep blue, default) and
  `dracula-at-night` (dark Dracula variant).
- Every theme bundled by Shiki — `dracula`, `tokyo-night`, `catppuccin-mocha`,
  `nord`, `one-dark-pro`, `github-dark`, `monokai`, plus 58 others. 67 themes
  total.

## Runtime theme picker

Open with `Ctrl+T` from `navigation` mode.

| Key                 | Action                                       |
| ------------------- | -------------------------------------------- |
| `j` / `k`           | Preview next / previous theme                |
| `↑` / `↓`           | Same                                         |
| `Ctrl+N` / `Ctrl+P` | Same                                         |
| `Enter`             | Confirm selection (persists to `aimux.json`) |
| `Esc`               | Restore the original theme and close         |
| `/`                 | Enter filter mode                            |

In filter mode typing narrows by id or display name; `Enter` confirms, `Esc`
clears.

## Theme shape

A theme is a `Theme` object:

```ts
interface Theme {
  name: string // id (e.g. 'aimux')
  displayName: string // shown in picker
  type: 'dark' | 'light'
  fg: string // default foreground
  bg: string // default background
  colors: Record<string, string> // VSCode workbench color keys
  settings: ThemeTokenRule[] // TextMate token rules
  // plus optional tokenColors, colorReplacements, semantic*
}
```

`colors` is indexed by VSCode workbench keys (`editor.background`,
`sideBar.background`, `textLink.foreground`, `terminal.ansiRed`, …). aimux's
UI reads a documented subset directly from this map — no intermediate aliases.

## Authoring user themes

Declare themes in `aimux.config.ts`. They appear in the picker next to the
built-ins and power both UI chrome and code highlighting.

### `themes.define(name, base, overrides)` — palette shortcut

Patch a few VSCode color keys on top of an existing theme:

```ts
import { defineConfig, themes } from '@brimveyn/aimux-config'

export default defineConfig({
  theme: 'my-neon',
  themes: {
    'my-neon': themes.define('My Neon', 'aimux', {
      'textLink.foreground': '#ff00aa',
      'terminal.ansiMagenta': '#00ffcc',
    }),
  },
})
```

Token settings (syntax highlighting rules) inherit from the base theme
unchanged.

### `themes.full(theme)` — raw shiki theme

Drop a VSCode theme JSON verbatim:

```ts
themes.full({
  name: 'my-theme',
  displayName: 'My Theme',
  type: 'dark',
  fg: '#eeeeee',
  bg: '#1a1a1a',
  colors: {
    'editor.background': '#1a1a1a',
    'editor.foreground': '#eeeeee',
    'textLink.foreground': '#88c0d0',
    // …
  },
  settings: [
    { scope: ['comment'], settings: { foreground: '#666', fontStyle: 'italic' } },
    { scope: ['keyword'], settings: { foreground: '#ff79c6', fontStyle: 'bold' } },
    // …
  ],
})
```

Any valid VSCode theme works — paste from `https://github.com/...`, tweak,
ship.

## Key reference

aimux reads these VSCode keys from `theme.colors` at runtime. They're all
guaranteed to be populated on every shipped theme (the build-time normalizer
fills gaps via a fallback chain). User themes are normalized the same way at
registration — missing keys resolve to a sensible default.

| VSCode key                                        | Aimux uses it for                |
| ------------------------------------------------- | -------------------------------- |
| `editor.background`                               | app background                   |
| `editor.foreground`                               | default text color               |
| `editor.lineHighlightBackground`                  | subtle banding / dim backgrounds |
| `editor.selectionBackground`                      | list / text selection            |
| `editorLineNumber.foreground`                     | diff gutter, hint text           |
| `sideBar.background`                              | side panels, surfaces            |
| `sideBarSectionHeader.background`                 | section headers                  |
| `editorGroupHeader.tabsBackground`                | tab strip                        |
| `editorWidget.background`                         | modal / overlay backgrounds      |
| `editorGroup.border`                              | pane separators                  |
| `focusBorder`                                     | active tab / focused input       |
| `list.activeSelectionBackground`                  | selected list row                |
| `descriptionForeground`                           | muted / secondary text           |
| `textLink.foreground`                             | accents, headings                |
| `errorForeground` / `editorError.foreground`      | errors, `D` git status           |
| `editorWarning.foreground`                        | warnings, `M` git status         |
| `terminal.ansiRed/Green/Yellow/Blue/Magenta/Cyan` | ANSI-style accents in UI         |
| `gitDecoration.addedResourceForeground`           | additions, `A` git status        |
| `gitDecoration.modifiedResourceForeground`        | modified files                   |
| `gitDecoration.deletedResourceForeground`         | deleted files                    |
| `gitDecoration.untrackedResourceForeground`       | untracked files                  |
| `diffEditor.insertedLineBackground`               | diff add background              |
| `diffEditor.removedLineBackground`                | diff remove background           |

The full list lives in `AIMUX_COLOR_KEYS` (`@brimveyn/aimux-config`). Themes
can also define any other VSCode key — aimux preserves extra entries so
`highlighter.loadTheme(theme)` sees them exactly as shipped.

## Syntax highlighting

Every theme carries real TextMate `settings`. The diff view calls
`highlighter.loadTheme(THEMES[id])` directly — the colors you see in the UI
and the colors on code tokens come from the same theme object.

## Persistence & migration

- Picker writes `themeId` to `aimux.json` on confirm.
- On next launch: persisted id → `resolvedConfig.theme` → `aimux`.
- Legacy ids renamed to shiki equivalents are auto-migrated:

| old id         | resolves to         |
| -------------- | ------------------- |
| `everforest`   | `everforest-dark`   |
| `gruvbox-dark` | `gruvbox-dark-hard` |
| `kanagawa`     | `kanagawa-wave`     |
| `one-dark`     | `one-dark-pro`      |

## Migrating from the old palette API

Earlier aimux versions exposed a 17-field `ThemeColors` alias (`accent`,
`panel`, `textMuted`, …). Those aliases are gone. Rewrite user themes using
VSCode keys:

| old alias        | VSCode key                              |
| ---------------- | --------------------------------------- |
| `background`     | `editor.background`                     |
| `text`           | `editor.foreground`                     |
| `textMuted`      | `descriptionForeground`                 |
| `panel`          | `sideBar.background`                    |
| `panelMuted`     | `sideBarSectionHeader.background`       |
| `panelHighlight` | `list.activeSelectionBackground`        |
| `overlay`        | `editorWidget.background`               |
| `border`         | `editorGroup.border`                    |
| `borderActive`   | `focusBorder`                           |
| `dim`            | `editor.lineHighlightBackground`        |
| `accent`         | `textLink.foreground`                   |
| `accentAlt`      | `terminal.ansiMagenta`                  |
| `warning`        | `editorWarning.foreground`              |
| `danger`         | `editorError.foreground`                |
| `success`        | `gitDecoration.addedResourceForeground` |
| `diffAddBg`      | `diffEditor.insertedLineBackground`     |
| `diffRemoveBg`   | `diffEditor.removedLineBackground`      |
