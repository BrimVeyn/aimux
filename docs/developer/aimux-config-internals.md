---
title: aimux-config Internals
description: Builder internals, merge rules, and support-status caveats.
---

# `aimux-config` Internals

This page explains the current behavior of the `@brimveyn/aimux-config` package
as implemented today.

## Public Role of the Package

The package exists to provide:

- a typed authoring surface for `aimux.config.ts`
- shipped default keymaps
- action factories
- theme helpers
- exported types for tooling and integration

The actual runtime consumption still happens inside `@brimveyn/aimux`.

## `defineConfig`

`defineConfig` is intentionally small. It is a typed pass-through helper.

The loader lives in `aimux`, not in this package.

## Builder Classes

Main classes:

- `KeymapBuilder`
- `ModeBindingBuilder`
- `GroupBuilder`

### `KeymapBuilder`

Internal defaults:

- leader: `<Space>`
- timeout: `300`

This is a builder default, not the same thing as the shipped runtime default.

### `ModeBindingBuilder`

Builds a mode definition with:

- `bindings`
- `removals`
- `isPassthrough`

### `GroupBuilder`

Sugar for prefixed key groups, usually used with leader-based subtrees.

It stamps the `group` label onto generated bindings so help and grouping logic
can render them later.

## Shipped Defaults

`getDefaultKeymapConfig()` constructs the runtime default keymap.

Important facts:

- shipped leader: `<C-w>`
- shipped timeout: `300`
- defaults cover navigation, terminal-input, git mode, and multiple modal modes

This difference between builder defaults and shipped defaults is the source of an
important caveat.

## Resolver Semantics

`resolveConfig(userConfig)`:

1. starts from `getDefaultKeymapConfig()`
2. builds user keymaps on a fresh `KeymapBuilder`
3. overlays user bindings on top of defaults
4. returns a `ResolvedConfig`

### Key merge behavior

- user bindings override default bindings with the same `keys` string
- `unmap()` removes defaults before user bindings are overlaid
- `passthrough()` is merged with logical OR
- repeated mode definitions merge
- multi-mode definitions write into every listed mode

### Leader caveat

The resolver currently uses this rule:

- if user leader is not `<Space>`, it overrides the shipped leader
- otherwise the shipped leader remains the default leader

Because the fresh builder starts at `<Space>`, explicitly writing
`.leader('<Space>')` does not behave like a normal override of the shipped
`<C-w>` default.

This is why user-facing docs should not recommend `.leader('<Space>')` as the
canonical way to switch to a Space leader today.

## Actions

The package exports both:

- static `KeyResult` values
- dynamic `ActionFn` factories that inspect runtime state

This is how the builder can model both simple keybindings and conditional
behavior such as closing the active tab only when one exists.

## Themes

The package exports:

- `THEMES` — merged record of generated shiki themes (`themes.generated.ts`)
  and hand-curated house themes (`house-themes.ts`).
- `THEME_IDS` — stable order: shiki ids first, house ids last.
- `themes.define(name, base, overrides)` — builds a `NamedThemeDefinition` for
  the `themes` config map.
- `themes.extend(base, overrides)` — lower-level, unnamed variant.
- `migrateThemeId(id)` — resolves a persisted id through legacy aliases.

House themes are shipped in `house-themes.ts` (duplicated in `src/ui/`).
`scripts/generate-themes.ts` only writes the shiki portion; house themes are
edited by hand.

## Backends and Other Deferred Surfaces

Current support status:

- `backends` - typed surface only
- `sidebar` - typed surface only
- `hooks` - typed surface only
- `snippets` - typed surface only

These fields are still worth documenting for API completeness, but not as if the
runtime already consumes them fully.

## Exported Types

The package exports many runtime-shaped types such as `AppState`, `ModeContext`,
`ResolvedConfig`, and `ResolvedKeymapConfig`.

Those exports are useful for tooling and advanced integration, but the docs
should distinguish between:

- the stable authoring surface for users
- exports that exist mainly for tooling or internal structural compatibility
