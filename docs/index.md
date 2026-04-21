---
title: aimux
description: Terminal multiplexer for AI CLIs — Claude, Codex, OpenCode, and shells in one TUI.
---

# aimux Documentation

This directory contains the detailed documentation for `@brimveyn/aimux` and
`@brimveyn/aimux-config`.

## Start Here

- `../README.md` - product overview, installation, quick start
- `../packages/aimux-config/README.md` - typed configuration quick start
- `getting-started.md` - first-run setup and first workspace

## Concepts

- `concepts/config-and-state.md` - the canonical explanation of `aimux.config.ts`
  versus `aimux.json`, `aimux-sessions.json`, and `aimux-snippets.json`
- `concepts/profiles.md` - profile selection, environment variables, directory
  layout, and runtime isolation

## Guides

- `guide/sessions.md` - workspace picker, project-bound workspaces, persistence,
  reordering, and reconnect behavior
- `guide/keymaps.md` - key notation, modes, leader keys, multi-key sequences,
  help metadata, and override rules
- `guide/themes.md` - built-in themes, the theme picker, and typed theme helpers
- `guide/git-mode.md` - git-mode workflow: panel, diff view, keybindings,
  help overlay, and commit flow

## Reference

- `reference/cli.md` - every CLI command and its behavior
- `reference/config-reference.md` - exhaustive `@brimveyn/aimux-config` reference
- `reference/runtime-paths.md` - config paths, catalog paths, runtime directories,
  and socket files

## Developer Notes

- `developer/architecture.md` - app, daemon, terminal-manager, and state flow
- `developer/aimux-config-internals.md` - builder internals, merge rules, and
  support-status caveats

## Support Status Labels

Some `@brimveyn/aimux-config` fields are typed and exported before the app fully
consumes them. The documentation uses these labels consistently:

- `Supported` - used by the runtime today
- `Partially supported` - accepted by the package surface, but only some runtime
  paths use it
- `Typed surface only` - accepted by the config package, but not currently wired
  into the app runtime
