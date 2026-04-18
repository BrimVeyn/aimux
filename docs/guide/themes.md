# Themes

`aimux` ships with built-in themes and a runtime theme picker.

The `@brimveyn/aimux-config` package also exposes typed theme helpers.

Those two layers overlap, but they are not currently equivalent.

## Built-in Theme IDs

The built-in IDs are:

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

## Runtime Theme Picker

The default shortcut is:

- `Ctrl+T` from `navigation` mode

Inside the theme picker:

- `j` / `k` move the preview selection
- arrow keys also move the selection
- `Enter` confirms the selected theme
- `Esc` restores the original theme and closes the modal

When you confirm a theme, the runtime persists the chosen `themeId` to
`aimux.json`.

## Typed Theme Helpers

`@brimveyn/aimux-config` exports:

- `themes.extend(baseThemeId, overrides)`
- `themes.create(colors)`
- `THEMES`
- `THEME_IDS`

Example:

```ts
import { defineConfig, themes } from '@brimveyn/aimux-config'

export default defineConfig({
  theme: themes.extend('tokyo-night', {
    accent: '#ff9e64',
  }),
})
```

## Support Status

| Surface                                      | Status              | Notes                                                                                          |
| -------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------- |
| Built-in theme picker                        | Supported           | Reads and writes `aimux.json.themeId`                                                          |
| Built-in theme IDs                           | Supported           | Used by the runtime today                                                                      |
| `themes.extend()`                            | Partially supported | Valid package API, but the runtime does not fully initialize from `resolvedConfig.theme`       |
| `themes.create()`                            | Partially supported | Same caveat as above                                                                           |
| top-level `theme` field in `aimux.config.ts` | Partially supported | Exposed by the config package, but app startup currently initializes from `aimux.json.themeId` |

## Recommendation

For the most predictable runtime behavior today:

- use the built-in theme picker for day-to-day theme switching
- treat typed theme definitions as advanced package surface area, not as the
  primary runtime control path

If you document team setup for other users, describe this as `Partially
supported` rather than fully supported.
