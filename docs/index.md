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
- `getting-started.md` - first-run setup and first project

## Concepts

- `concepts/config-and-state.md` - the canonical explanation of `aimux.config.ts`
  versus `aimux.json`, `aimux-projects.json`, and `aimux-snippets.json`
- `concepts/profiles.md` - profile selection, environment variables, directory
  layout, and runtime isolation

## Guides

- `guide/settings.md` - the in-app settings screen: navigation, which file each
  setting lands in, and how it interacts with `aimux.config.ts`
- `guide/projects.md` - project picker, project creation, persistence,
  reordering, and reconnect behavior
- `guide/keymaps.md` - key notation, modes, leader keys, multi-key sequences,
  help metadata, and override rules
- `guide/themes.md` - built-in themes, the theme picker, and typed theme helpers
- `guide/git-mode.md` - git-mode workflow: panel, diff view, keybindings,
  help overlay, and commit flow
- `guide/workspaces.md` - per-project workspaces (git worktrees): create,
  review against base, and squash-move work between them
- `guide/snippets.md` - reusable text fragments: picker, inline triggers,
  built-in variables, cursor placement, shell-backed variables, undo
- `guide/claude-integration.md` - Claude Code hook bridge: what aimux adds to
  `~/.claude/settings.json`, how the hook server resolves PTYs, opt-out
- `guide/usage-history.md` - long-term AI usage stats: activity heatmap, tokens
  per model and per git branch, the daily rollup, and where the data lives
- `guide/plugins.md` - installing, configuring and switching off plugins,
  including the ones aimux ships with

## Reference

- `reference/cli.md` - every CLI command and its behavior, including the
  headless control plane (`tab`, `project`, `workspace`)
- `reference/config-reference.md` - exhaustive `@brimveyn/aimux-config` reference
- `reference/runtime-paths.md` - config paths, catalog paths, runtime directories,
  and socket files
- `reference/plugin-api.md` - every export of `@brimveyn/aimux-plugin`,
  generated from the sources

## Developer Notes

- `developer/architecture.md` - app, daemon, terminal-manager, and state flow
- `developer/hot-reexec.md` - additive protocol contract and the daemon
  hot-reexec swap that keeps PTYs alive across upgrades
- `developer/aimux-config-internals.md` - builder internals, merge rules, and
  support-status caveats
- `developer/toasts.md` - the transient notification system: imperative API,
  options, and architecture
- `developer/plugins.md` - the plugin kernel: hosts, halves, module loading,
  lifecycle, every surface, and the built-in plugins
- `../examples/plugins/` - four example plugins, typechecked with the repo:
  a model shifter, a load graph, a commit grid, a stats pane

## Support Status Labels

Some `@brimveyn/aimux-config` fields are typed and exported before the app fully
consumes them. The documentation uses these labels consistently:

- `Supported` - used by the runtime today
- `Partially supported` - accepted by the package surface, but only some runtime
  paths use it
- `Typed surface only` - accepted by the config package, but not currently wired
  into the app runtime
