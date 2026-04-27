---
title: Themes
description: Built-in themes, the theme picker, and typed theme helpers.
---

# Themes

aimux themes are [Shiki](https://shiki.style/themes) themes. The runtime works
with full theme objects internally, while `aimux.config.ts` exposes startup
theme selection plus palette overrides for the chosen base theme.

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

## Theme config

`aimux.config.ts` exposes a small typed theme surface:

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

- `theme.initialMode` is a startup override for the built-in light or dark
  family.
- `theme.paletteOverrides` customizes the active palette on top of whichever
  base theme the runtime chooses.

This config does not replace the runtime theme picker. The picker still persists
the selected theme id separately in `aimux.json`.

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
- On next launch: persisted id → `theme.initialMode` → built-in dark fallback.
- `theme.paletteOverrides` applies on top of the chosen base theme.
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

## Beta — Harmonize Claude Code colors

Aimux can push the active theme into Claude Code itself so the assistant's
output matches the rest of the app. Off by default.

```ts
// aimux.config.ts
export default defineConfig({
  theme: {
    initialId: 'aimux',
    beta: {
      harmonizeClaudeTheme: true,
    },
  },
})
```

When the flag is on:

- aimux writes `~/.claude/themes/aimux.json` from the resolved aimux palette.
- aimux sets `"theme": "custom:aimux"` in `~/.claude/settings.json` (other
  fields preserved, write is atomic).
- Switching theme inside aimux rewrites the file. Claude Code watches its
  themes dir and repaints live without restarting the session.

Mapping (Claude token → aimux token): `claude` → `accent`, `error` → `error`,
`success` → `success`, `warning` → `warning`, `planMode` → `info`,
`bashBorder` → `warning`, `promptBorder` → `border`, `diffAdded` →
`diffAddedBg`, `diffRemoved` → `diffRemovedBg`,
`userMessageBackground` → `backgroundPanel`, `text` → `text`,
`inactive` → `textMuted`. Tokens we don't override (Shimmer variants, dim
diffs, subagent colors) fall through to Claude's `dark`/`light` preset.

Requirements: Claude Code v2.1.118 or later. Limits: Claude's truecolor
escapes (24-bit hex) bypass the theme — those colors stay native.

To revert: turn the flag off and either delete `~/.claude/themes/aimux.json`
or pick a different theme via Claude's `/theme` command.
