# lazygit

lazygit in a pane beside your agent, running in the workspace you are in.

`<leader>g` opens it and closes it again; the manifest asks for the key, so
linking the plugin is the whole setup:

```jsonc
"panes": [{ "id": "git", "title": "lazygit", "command": ["lazygit"], "cwd": "workspace" }],
"contributes": {
  "keymaps": [{ "mode": "navigation", "key": "<leader>g", "action": "toggle" }]
}
```

## What it demonstrates

- a **pane that runs a program** (`panes[]` in the manifest) — a real terminal
  tab aimux owns for the plugin, which takes the keyboard like any terminal
- **`cwd: "workspace"`**: the pane follows the workspace you are in, so
  lazygit opens on the worktree the agent is working in, not the repo root
- **`ctx.ui.panes.openCommandPanes()`**, because a command pane has a process
  and a toggle needs to know whether one is running
- a **titled action** (`actions.register(verb, handler, { title })`), which
  is what makes `Toggle lazygit` appear in `aimux action list` and in any
  command palette

## The lifecycle, without a line about it

The manifest declares the pane and the UI host registers it from the plugin
_record_, not from the running code. That is why:

- reloading the plugin leaves lazygit where it is — the same id is adopted
- unlinking or disabling the plugin closes the pane, lazygit included
- quitting lazygit leaves the pane saying so; `Ctrl+r` starts it again

None of that is written here, and it could not be written better here.

## The part it had to guess

That `lazygit` is on your `PATH`. A pane whose program is missing shows the
shell's error rather than a blank rectangle, which is the honest failure;
change `command` in the manifest to point at a full path if you keep it
elsewhere.
