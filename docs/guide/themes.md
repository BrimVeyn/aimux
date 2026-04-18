# Themes

aimux ships two house themes (`aimux`, `dracula-at-night`) plus the full
[Shiki](https://shiki.style) theme catalog, for a total of 67 themes — all
usable both as UI chrome and as the diff syntax-highlighting theme.

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

In filter mode:

- Type to narrow the list. Matches against both the theme id (e.g. `dracula-at-night`) and its display name.
- `Ctrl+N`/`Ctrl+P` or arrow keys continue to preview.
- `Enter` confirms, `Esc` clears the filter and returns to the picker.

## Built-in theme ids

Two house themes:

- `aimux` — the default theme. Teal accent on a deep blue background.
- `dracula-at-night` — darker take on Dracula.

Plus every theme bundled by [`shiki`](https://shiki.style/themes) — e.g.
`dracula`, `tokyo-night`, `catppuccin-mocha`, `nord`, `solarized-dark`,
`one-dark-pro`, `github-dark`, `monokai`, `vitesse-dark`, `gruvbox-dark-hard`,
`kanagawa-wave`, `everforest-dark`, and about fifty more.

## User-defined themes

Declare themes in `aimux.config.ts`. They appear in the picker next to the
built-ins and power syntax highlighting via a synthesized Shiki theme.

```ts
import { defineConfig, themes } from '@brimveyn/aimux-config'

export default defineConfig({
  // Initial theme — any built-in id, or an id from your `themes` map below.
  theme: 'my-neon',

  themes: {
    'my-neon': themes.define('My Neon', 'aimux', {
      accent: '#ff00aa',
      accentAlt: '#00ffcc',
    }),
    'my-mono': themes.define('Mono', 'solarized-dark', {
      accent: '#ffffff',
      accentAlt: '#aaaaaa',
    }),
  },
})
```

`themes.define(name, base, overrides)` takes a display name, a base theme to
inherit palette values from, and a partial `ThemeColors` override. Fields you
don't override are copied from the base.

### How syntax highlighting works for user themes

For built-in Shiki themes, the diff view tokenizes code with Shiki's native
theme. For user themes (and the house themes `aimux` / `dracula-at-night`),
aimux synthesizes a minimal Shiki theme from the palette:

| aimux token | Applied to                                |
| ----------- | ----------------------------------------- |
| `textMuted` | comments (italic)                         |
| `warning`   | strings, HTML attributes (italic)         |
| `accentAlt` | keywords (bold), regex / escape sequences |
| `danger`    | numbers, constants, HTML tags             |
| `success`   | function names                            |
| `accent`    | types (italic), object properties         |
| `text`      | variables                                 |

This covers the common scope surface — it won't reproduce the richness of a
hand-crafted VSCode theme, but keeps code colors consistent with the UI.

## Persistence

When you confirm a theme in the picker, aimux writes `themeId` to
`aimux.json`. On next launch:

1. Persisted `themeId` wins if it resolves to a known theme (built-in or user).
2. Otherwise the `theme` field from `aimux.config.ts` is used.
3. Otherwise `aimux`.

If a persisted id is no longer known (theme removed from config, renamed, etc.)
aimux falls back to the default.

## Legacy theme migration

Older aimux builds shipped a handful of themes that have been renamed to match
Shiki's bundled ids. If your `aimux.json` has one of these, it's auto-migrated:

| old id         | resolves to         |
| -------------- | ------------------- |
| `everforest`   | `everforest-dark`   |
| `gruvbox-dark` | `gruvbox-dark-hard` |
| `kanagawa`     | `kanagawa-wave`     |
| `one-dark`     | `one-dark-pro`      |

`aimux` and `dracula-at-night` are shipped under their original ids and need
no migration.
