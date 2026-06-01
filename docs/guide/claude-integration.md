---
title: Claude Code Integration
description: How aimux drives per-tab activity state from Claude Code's lifecycle hooks.
---

# Claude Code Integration

When the active assistant in a tab is Claude Code, aimux drives the tab's
activity indicator (`working` / `waiting-input` / `idle`) from Claude's own
lifecycle hooks, not from scraping the terminal. Hooks fire deterministically
on prompt submit, tool calls, completion, and notifications, which avoids the
false-`idle` flicker the visual classifier produces when an overlay (e.g.
**Ctrl+T** todo list) blanks the viewport.

A small visual classifier still runs as a fallback — it owns the
`waiting-input` verdict (permission prompts, `tab to amend`, yes/no dialogs)
even when a Claude hook says `working`.

## What aimux Installs

On first launch the app idempotently patches `~/.claude/settings.json`,
appending six hook entries — one per event aimux needs:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "<aimux-install-dir>/assets/claude-hooks/aimux-agent-state.sh",
            "__aimux": true
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "*",
        "hooks": [{ "type": "command", "command": "<...>", "__aimux": true }]
      }
    ],
    "PostToolUse": [
      { "matcher": "*", "hooks": [{ "type": "command", "command": "<...>", "__aimux": true }] }
    ],
    "Stop": [{ "hooks": [{ "type": "command", "command": "<...>", "__aimux": true }] }],
    "SubagentStop": [{ "hooks": [{ "type": "command", "command": "<...>", "__aimux": true }] }],
    "Notification": [{ "hooks": [{ "type": "command", "command": "<...>", "__aimux": true }] }]
  }
}
```

Entries carry the marker `__aimux: true`. On every aimux startup the installer
removes any existing aimux-marked entry and rewrites it with the current
absolute script path. Hooks you added manually (without the marker) are
preserved untouched.

## The Hook Bridge Script

`assets/claude-hooks/aimux-agent-state.sh` is a small POSIX shell script that:

1. Resolves the daemon's hook URL from `$AIMUX_HOOK_URL_FILE` (preferred) or
   `$AIMUX_HOOK_URL` (legacy fallback).
2. Reads the Claude hook payload from stdin.
3. Augments it with `aimuxPaneId` (from `$AIMUX_PANE_ID`).
4. POSTs the merged JSON to `http://127.0.0.1:<port>/hook/claude` with a 2 s
   timeout.
5. Always exits 0 — a hook failure must never break Claude.

The script is invoked once per Claude lifecycle event, by Claude Code itself.

## How aimux Tells the Script Where to POST

The daemon starts a local `Bun.serve` listener on `127.0.0.1` with an
OS-assigned port. The URL is written to a stable per-profile file:

```text
<runtime-dir>/aimux-<profile>/claude-hook.url
```

(See [Runtime Paths](../reference/runtime-paths.md).)

When the daemon spawns a PTY through the terminal-manager, it injects two
environment variables:

| Variable              | Value                                                        |
| --------------------- | ------------------------------------------------------------ |
| `AIMUX_PANE_ID`       | The tab id this PTY belongs to.                              |
| `AIMUX_HOOK_URL_FILE` | Absolute path to the URL file above. **Not** the URL itself. |

Pointing at the _file_ instead of baking the URL into env is deliberate: a
long-lived PTY survives a daemon restart (the terminal-manager has a grace
window). On the next Claude hook, the script re-reads the file and reaches
the _new_ daemon — no stale URL, no dead-port timeouts.

## Subagent Filter

Claude Code emits the standard hook events from inside a Task subagent too.
Routing those to the parent pane would flip it to `idle` while the parent is
still mid-turn. aimux ignores:

- `SubagentStop` (always).
- Any event whose payload carries a non-empty `parent_tool_use_id`.

This keeps the parent pane's activity correct while subagents run.

## Arbitration Between Hook and Visual Classifier

For 10 seconds after a hook event lands, the hook verdict overrides the
visual classifier — except when the visual sees a `waiting-input` prompt, in
which case the visual wins (it catches permission prompts that don't trigger
a `Notification` hook). After 10 s with no hook, the visual classifier takes
over.

| Hook event                          | Mapped activity |
| ----------------------------------- | --------------- |
| `UserPromptSubmit`                  | `working`       |
| `PreToolUse`                        | `working`       |
| `PostToolUse`                       | `working`       |
| `Stop`                              | `idle`          |
| `Notification`                      | `waiting-input` |
| `SubagentStop`                      | _ignored_       |
| any event with `parent_tool_use_id` | _ignored_       |

## Opting Out

aimux installs hooks unconditionally on every launch. To opt out:

1. Stop aimux.
2. Open `~/.claude/settings.json` and delete the entries carrying
   `"__aimux": true`. Other entries you may have added stay untouched.
3. _Do not relaunch aimux_ — it will reinstall them on next mount.

A configurable opt-out flag is a planned follow-up.

## Verifying the Integration

After launching aimux on a build that includes this integration:

```sh
# 1. The daemon should have published its hook URL.
cat ~/.local/state/aimux-default/claude-hook.url
#   => http://127.0.0.1:NNNNN/hook/claude

# 2. settings.json should contain six __aimux entries.
jq '.hooks' ~/.claude/settings.json

# 3. End-to-end probe (replace TAB_ID with a real tab id from the sidebar).
URL=$(cat ~/.local/state/aimux-default/claude-hook.url)
curl -s -X POST -H 'Content-Type: application/json' \
  --data '{"aimuxPaneId":"TAB_ID","hook_event_name":"PreToolUse"}' \
  "$URL"
# Expected: ok
# The tab should flip to `working` within a tick (500 ms).
```

Replace `aimux-default` with `aimux-dev` (or whatever your profile is) if you
run aimux under a non-default `AIMUX_PROFILE`.

## Troubleshooting

The Claude session that's already running won't see new hooks until Claude is
restarted — Claude Code reads `settings.json` at session start. If you just
installed aimux or just enabled the integration, close and reopen the Claude
tab.

If `claude-hook.url` is missing under the runtime directory, the daemon
either failed to bind a port (look for `daemon.hookServer.startFailed` in
debug logs) or hasn't been restarted with a build that includes the
integration (`aimux restart-daemon` and `aimux restart-terminal-manager`).

The manager IPC protocol was bumped to v6 to carry the per-spawn `env`
needed by this feature. A pre-v6 terminal-manager left running across an
aimux upgrade will refuse the new daemon's handshake. Restart the terminal
manager:

```sh
aimux restart-terminal-manager
```

## Related Docs

- [Runtime Paths](../reference/runtime-paths.md) — where `claude-hook.url`
  lives per profile.
- [Architecture](../developer/architecture.md) — the daemon / terminal-manager
  / app split that the hook server bolts onto.
