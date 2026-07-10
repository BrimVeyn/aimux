---
title: CLI Reference
description: Every aimux command — TUI, control commands, and the headless control plane (tab/workspace/worktree).
---

# CLI Reference

The `aimux` CLI has two personas:

- **Interactive** — `aimux` launches the TUI. `aimux doctor`, `aimux update`,
  and the restart commands manage the local install.
- **Headless control plane** — `aimux tab …`, `aimux workspace …`, and
  `aimux worktree …` drive the running daemon over its IPC socket without
  the TUI. Every command writes one JSON object on stdout (or an NDJSON
  stream for `tab wait` / `tab tail`), so an outer script or agent can pipe
  the output through `jq`.

All commands are profile-aware — they use `AIMUX_PROFILE` (or the shared
`--profile` flag) to pick the runtime directory and daemon socket.

## Exit Codes

| Code  | Meaning                                                          |
| ----- | ---------------------------------------------------------------- |
| `0`   | Success                                                          |
| `2`   | Usage error (bad flags, missing required argument)               |
| `3`   | Runtime error (tab crashed, git refused a worktree operation, …) |
| `4`   | Daemon unreachable — socket missing, spawn failed, no handshake  |
| `10`  | `tab run` / `tab await`: worker is blocked on a question/permission |
| `124` | `--timeout` expired before the awaited event arrived             |

## Shared Flags

Every headless command accepts:

| Flag                     | Meaning                                                                         |
| ------------------------ | ------------------------------------------------------------------------------- |
| `--workspace <name\|id>` | Target workspace. Defaults to the catalog entry with the newest `lastOpenedAt`. |
| `--profile <name>`       | Override `AIMUX_PROFILE` for this invocation.                                   |

## TUI + Local Install

### `aimux`

Starts the TUI.

At startup the CLI:

- resolves the active runtime profile
- creates or connects to the internal session backend that powers workspace state
- loads user config from the active profile
- renders the app

### `aimux version`

Prints the package version and exits. Aliases: `aimux --version`, `aimux -v`.

### `aimux doctor`

Runs setup diagnostics and exits with a status code. Use this to validate
the local installation and persisted config.

### `aimux update`

Runs the self-update flow. When the daemon supports hot-reexec (see
`developer/hot-reexec.md`), an update can swap the daemon without killing
live PTYs.

### `aimux restart-daemon`

Restarts the IPC daemon only. Preferred over `restart-terminal-manager`
when refreshing the app-facing runtime — PTYs survive.

### `aimux restart-terminal-manager`

Restarts the long-lived terminal manager. Destructive: every live PTY dies.

### Hidden internal commands

Used by the runtime itself, not typical user entrypoints:

- `aimux daemon`
- `aimux terminal-manager`

## Headless Control Plane

Every control-plane command routes to the daemon (auto-spawning it if the
socket is missing). If the daemon predates a capability the command needs,
it errors out with a message telling you to restart `aimux`.

### Tab commands

#### `aimux tab list`

Lists tabs in the target workspace.

```
aimux tab list [--verbose] [--workspace W]
-> { tabs: [{ id, assistant, title, status, activity, command, worktreeId? }],
     activeTabId }
```

`--verbose` adds `lastLine` — the tab's last non-blank rendered line — to each
entry, so a fleet poll can read "what each worker is doing" without a
`snapshot` per tab. Requires a daemon advertising `listTabsLastLine` (v13).

#### `aimux tab create`

Creates a new tab.

```
aimux tab create --assistant <id> [--title T] [--cwd .] [--command CMD]
                 [--model M] [--effort E]
                 [--worktree WT | --new-worktree[=<name>] [--base R] [--branch B]]
                 [--workspace W]
-> { tabId, assistant, title, command, cwd, model, effort,
     worktreeId, path, branch, name }   # worktree fields null when none
```

- **cwd** defaults to the resolved worktree's path (so a worker spawned into a
  worktree actually runs inside it); an explicit `--cwd` overrides.
- **`--command`** overrides the assistant's default binary entirely.
- **`--model` / `--effort`** map to the assistant's own flags (claude
  `--model`/`--effort`; codex `--model` + `-c model_reasoning_effort=…`; opencode
  `--model` only). They append to the resolved base command and **cannot** be
  combined with `--command`. Values aren't validated by aimux — a bad one makes
  the worker CLI fail at startup.
- **customCommands**: the base command is resolved as
  `--command` > the workspace's persisted `customCommands[assistant]` > the
  builtin default, so CLI-spawned tabs inherit e.g. `claude
  --dangerously-skip-permissions` exactly like the UI. `--command claude` is the
  bypass.
- **`--worktree WT`** pins the tab to an existing worktree id (co-locate several
  tabs in one tree); without it the workspace's active worktree is used.
- **`--new-worktree[=<name>]`** creates a fresh worktree (branch `aimux/<name>`
  off `--base`, default HEAD) and runs the tab in it, emitting the worktree's
  `path`/`branch`/`name`. A bare flag derives the name; the `=` form names it.
  Mutually exclusive with `--worktree` and `--cwd`; `--base`/`--branch` require
  it.

#### `aimux tab send`

Writes text (or a key chord) to a tab. Exactly one of `<text>`, `--stdin`,
or `--keys` supplies the payload.

```
aimux tab send <tabId> <text>
aimux tab send <tabId> --enter <text>      # appends \r so the CLI submits
aimux tab send <tabId> --keys "<C-c>"      # chord parser -> raw bytes
aimux tab send <tabId> --stdin             # read from stdin
aimux tab send <tabId> --prompt-file F     # read from a file (no shell redirect)
aimux tab send <tabId> --enter --await-submit <text>   # + confirm uptake
-> { ok: true, bytesWritten: N }
-> { ok: true, bytesWritten: N, submitted: true,       # with --await-submit
     uptake: { confirmed: true, ms } | { confirmed: false } }
```

Chord syntax mirrors `@brimveyn/aimux-config`'s keymap builder:
`<C-x>`, `<Esc>`, `<CR>`, `<Tab>`, `<Up>`, chained (`<Up><Up>`), etc.
Multi-line text is auto-wrapped in bracketed-paste so the receiver doesn't
misread newlines as submit. With `--enter`, the submitting `\r` is sent as a
separate, settled write after the paste — a paste-aware TUI (e.g. Claude Code)
would otherwise fold a same-burst `\r` into the paste buffer and never submit.

`--await-submit` (requires `--enter`) blocks after the write until the tab
transitions to `working` — i.e. the receiving CLI accepted the prompt — or
`--await-timeout` ms elapse (default 15000). Uptake is advisory: a missed
transition still exits 0 with `uptake.confirmed: false`. For a full
submit→turn-end round-trip, prefer `tab run` below.

#### `aimux tab run`

The high-leverage orchestration verb: submit a prompt, then block until the
worker's turn completes **or** it asks a question, and return a structured
outcome. Collapses spawn→send→uptake→await→snapshot into one event-driven call
that reports facts, not screen-scraped heuristics.

```
aimux tab run <tabId> [--prompt-file F | --stdin | <text>] [--timeout 900000] [--no-enter]
-> { outcome: 'completed', durationMs }                          exit 0
-> { outcome: 'question', kind, question, options?, durationMs } exit 10
-> { outcome: 'timeout', durationMs }                            exit 124
-> { outcome: 'error', error, durationMs }                       exit 3
```

Exactly one of `--prompt-file`, `--stdin`, or `<text>` supplies the prompt.
After submitting, `run` waits for the `tabTurnComplete` signal (an authoritative
end-of-turn: `idle` held for the settle window) or a `tabQuestion` event
(`kind` ∈ `question | permission`, `question` = the captured prompt text,
`options` = a best-effort parse of the choices). It is uptake-guarded — it
ignores `tabTurnComplete` until it has first seen the tab go `working`, so a
lingering pre-submit `idle` is never misread as "completed". Requires a daemon
advertising `turnLifecycle` + `questionEvents` (v13).

#### `aimux tab await`

The standalone half of `tab run`: block until a tab's **in-flight** turn ends or
the worker asks — without submitting anything. Use it for a turn you started by
hand (a `tab send --enter`, or a worker you nudged). Same outcome JSON and exit
codes as `tab run`.

```
aimux tab await <tabId> [--timeout 900000]
-> { outcome: 'completed', durationMs }                          exit 0
-> { outcome: 'question', kind, question, durationMs }           exit 10
-> { outcome: 'timeout', durationMs }                            exit 124
-> { outcome: 'error', error, durationMs }                       exit 3
```

Seeded from the attach replay so it never hangs or lies: a tab already `working`
is awaited to completion; an already `waiting-input` tab returns `question`
immediately (with a best-effort snapshot tail as the text — `kind` is
`question`, real options aren't recoverable from a replay); an `idle` tab is
awaited for a **fresh** working→idle cycle, so a stale already-finished turn is
never re-reported as "completed" (it times out instead). A missing tab is exit
`3` (`tab not found`) — the re-spawn signal — not `4`, which stays
daemon-unreachable. Requires `turnLifecycle` + `questionEvents` (v13); no new
capability.

#### `aimux tab focus`

Sets the active tab in the workspace.

```
aimux tab focus <tabId> -> { ok: true }
```

#### `aimux tab close`

Closes a tab. The daemon broadcasts `tabExit` so an attached UI updates.

```
aimux tab close <tabId> -> { ok: true }
```

#### `aimux tab snapshot`

Snapshots the visible viewport as plain text.

```
aimux tab snapshot <tabId> [--tail N] [--format json|text] [--no-trim]
-> { tabId, cols, rows, lines: [...], cursor: { row, col, visible } }   # json
-> raw lines (no framing)                                              # text
```

`--tail N` returns only the last N non-blank lines. `--no-trim` preserves
trailing whitespace on each line.

#### `aimux tab wait`

Blocks until the tab's activity reaches the requested state. Short-circuits
immediately if the tab is already there.

```
aimux tab wait <tabId> --status idle|working|waiting-input [--timeout 30000]
-> NDJSON stream of { ts, status }
   exit 0 when reached, 124 on timeout
```

#### `aimux tab tail`

Streams every `tabRender` event for the tab as NDJSON — one JSON object per
render frame, forever, until the tab exits or `--timeout` fires.

```
aimux tab tail <tabId> [--raw] [--rate-limit-ms N] [--follow-status] [--timeout N]
-> NDJSON: { ts, type: 'render'|'exit'|'error'|'status'|'timeout', ... }
   exit 0 on tabExit, 3 on tabError, 124 on --timeout
```

- `--raw` emits the whole `TerminalSnapshot` per render. Without it, only
  the trimmed `lines[]` + cursor are surfaced.
- `--rate-limit-ms N` coalesces bursts of renders arriving within N ms.
- `--follow-status` interleaves `tabStatus` transitions into the stream.

### Workspace commands

#### `aimux workspace list`

Lists the profile's workspace catalog.

```
aimux workspace list -> { workspaces: [{ id, name, projectPath, lastOpenedAt, ... }] }
```

#### `aimux workspace show`

Shows the resolved workspace (defaults to the most recently opened).

```
aimux workspace show [--workspace W]
-> { id, name, projectPath, activeWorktreeId, worktrees: [...] }
```

#### `aimux workspace create`

Creates a workspace. When a UI is attached the daemon relays the request to
the UI's reducer (preserving the live snapshot); headless, it writes the
catalog directly.

```
aimux workspace create <name> [--project P] [--switch]
                              [--wait] [--timeout N]
-> { name, projectPath, switch, sessionId? }
```

- `--switch` immediately makes the new workspace active.
- `--wait` requires `--switch`; blocks until the daemon broadcasts
  `workspaceSwitched`. Timeout defaults to 30 s.

#### `aimux workspace switch`

Switches the running UI (or bumps `lastOpenedAt` when headless).

```
aimux workspace switch <name|id> [--wait] [--timeout N]
-> { name, targetSessionId }
```

`--wait` subscribes to `workspaceSwitched` before sending the request, so
the both-paths case (UI attached vs. headless) is race-free.

The daemon validates the target against the catalog before broadcasting —
an unknown id fails the CLI fast rather than hanging on `--wait`.

#### `aimux workspace close`

Removes a workspace from the catalog. UI-attached path uses the UI's delete
handler; headless path writes the catalog directly.

```
aimux workspace close <name|id>
-> { closedSessionId, name }
```

### Worktree commands

Worktrees are per-workspace git worktrees, cross-checked against `git
worktree list` on inspection.

#### `aimux worktree list`

Lists worktrees for the workspace. `gitTracked` flags catalog rows that git
no longer sees (prunable / vanished).

```
aimux worktree list [--workspace W]
-> { workspaceId, activeWorktreeId, worktrees: [{ id, name, branch, path,
     repoRoot, source, gitTracked, createdByAimux }] }
```

#### `aimux worktree create`

Creates a git worktree AND registers it in the catalog. If the daemon
rejects the registration, the on-disk worktree is rolled back so `list`
never surfaces an orphan.

```
aimux worktree create --name N [--branch B] [--base ref] [--workspace W]
-> { id, name, branch, path, repoRoot }
```

- `--branch` defaults to `aimux/<name>`.
- `--base` defaults to `HEAD`.

#### `aimux worktree remove`

Removes a worktree. Git side runs first (respects the dirty-check unless
`--force`), then the catalog record is dropped. Refuses to remove the
primary worktree.

```
aimux worktree remove <id|path> [--force] [--workspace W]
-> { id, name, path }
```

## JSON Output Conventions

- One JSON object per invocation on stdout (`tab wait` and `tab tail` are
  NDJSON streams).
- No prose, no ANSI. Errors write a human-readable line to stderr AND a
  JSON object to stdout (`{ error, kind }`).
- Timestamps in streams (`ts`) are milliseconds since the CLI attached.

## Profile Awareness

Runtime-oriented commands use the active profile namespace. That affects:

- config file resolution for the TUI startup path
- workspace and snippet catalogs
- daemon socket path
- terminal-manager socket path

Commands such as `aimux version` and `aimux --help` exit early and do not
need to load profile-scoped runtime state. See `runtime-paths.md` for the
exact path rules.
