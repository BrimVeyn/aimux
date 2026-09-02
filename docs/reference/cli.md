---
title: CLI Reference
description: Every aimux command — TUI, control commands, and the headless control plane (tab/project/workspace).
---

# CLI Reference

The `aimux` CLI has two personas:

- **Interactive** — `aimux` launches the TUI. `aimux doctor`, `aimux update`,
  and the restart commands manage the local install.
- **Headless control plane** — `aimux worker …`, `aimux tab …`,
  `aimux project …`, and `aimux workspace …` drive the running daemon without
  the TUI. Every command writes one JSON object on stdout (or an NDJSON
  stream for `tab wait` / `tab tail`), so an outer script or agent can pipe
  the output through `jq`.

All commands are profile-aware — they use `AIMUX_PROFILE` (or the shared
`--profile` flag) to pick the runtime directory and daemon socket.

## Exit Codes

| Code  | Meaning                                                                                                    |
| ----- | ---------------------------------------------------------------------------------------------------------- |
| `0`   | Success                                                                                                    |
| `2`   | Usage error (bad flags, missing required argument)                                                         |
| `3`   | Runtime error (tab crashed, git refused a workspace operation, …)                                          |
| `4`   | Daemon unreachable — socket missing, spawn failed, no handshake                                            |
| `10`  | `tab run` / `tab await`: worker is blocked on a question/permission                                        |
| `11`  | `worker run/prompt --detach`: prompt is in the composer but no turn started (recover with `worker submit`) |
| `124` | `--timeout` expired before the awaited event arrived                                                       |

## Shared Flags

Every headless command accepts:

| Flag                   | Meaning                                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------------------- |
| `--project <name\|id>` | Target project. Falls back to `AIMUX_PROJECT`, then to the catalog entry with the newest `lastOpenedAt`. |
| `--profile <name>`     | Override `AIMUX_PROFILE` for this invocation.                                                            |

**Pin the project for anything long-running.** The default ("newest
`lastOpenedAt`") follows the UI: switching projects in the TUI changes what a
later CLI call resolves to, so a fleet dispatched without a pin can end up
cutting workspaces in a different repository. Pass `--project` per call or
export `AIMUX_PROJECT=<name|id>` once. Every `worker` command echoes the
resolved `project: { id, name, repoRoot }` so the target is verifiable from
the output, and `worker doctor` reports `project.source`
(`flag` | `env` | `active`).

## TUI + Local Install

### `aimux`

Starts the TUI.

At startup the CLI:

- resolves the active runtime profile
- creates or connects to the internal session backend that powers project state
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

### `aimux completion`

Shell tab completion for bash, zsh, and fish.

```
aimux completion install            # write the script for the detected shell
aimux completion install --shell zsh
aimux completion zsh > ~/.zfunc/_aimux   # or print it and place it yourself
```

**You normally never run this.** The first time the TUI starts (and again
after every upgrade) aimux writes the script for `$SHELL` into the
conventional location:

| Shell | Path                                                                                         |
| ----- | -------------------------------------------------------------------------------------------- |
| bash  | `$XDG_DATA_HOME/bash-completion/completions/aimux`                                           |
| zsh   | first writable `$fpath` entry under `$HOME`, else `$XDG_DATA_HOME/zsh/site-functions/_aimux` |
| fish  | `$XDG_CONFIG_HOME/fish/completions/aimux.fish`                                               |

Auto-install writes exactly one file and never edits a dotfile. If the zsh
directory it picked isn't on your `$fpath`, `aimux doctor` prints the single
line to add to `~/.zshrc`. Set `AIMUX_NO_COMPLETION_INSTALL=1` to opt out
entirely.

Completion covers groups, verbs, flag names (minus the ones already on the
line), fixed value vocabularies (`--status`, `--format`), assistant ids, and
projects. Path-taking flags (`--prompt-file`, `--cwd`, `--project`) hand off
to the shell's own filename completion.

Flags:

| Flag                        | Meaning                                                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `--shell <bash\|zsh\|fish>` | Override `$SHELL` detection when installing.                                                                                   |
| `--command <invocation>`    | What the script should invoke. Point it at a checkout to test a dev build: `--command "bun run /path/to/aimux/src/index.tsx"`. |

### Hidden internal commands

Used by the runtime itself, not typical user entrypoints:

- `aimux daemon`
- `aimux terminal-manager`
- `aimux __complete --cword <n> -- <words…>` — resolves one TAB press. Prints
  `value<TAB>description` lines plus a trailing `:list` / `:files` / `:none`
  directive, and always exits `0`: a shell is listening, not a human.

## Headless Control Plane

Every control-plane command routes to the daemon (auto-spawning it if the
socket is missing). If the daemon predates a capability the command needs,
it errors out with a message telling you to restart `aimux`.

### Worker commands

The `worker` group is the preferred interface for an agent orchestrating other
agents. It composes the lower-level tab and workspace primitives, gives each
worker a stable project-scoped name, and returns `schemaVersion: 1` envelopes.

```
aimux worker run --project repo --name auth --assistant claude --prompt-file /tmp/auth.md
aimux worker run --project repo --name api --assistant codex --stdin --detach
aimux worker prompt auth --prompt-file /tmp/correction.md [--replace]
aimux worker submit auth
aimux worker await api
aimux worker list [name|tab-id] [--all-projects]
aimux worker stop auth [--cleanup-workspace] [--force]
aimux worker doctor
```

Every envelope carries `project: { id, name, repoRoot }` alongside the worker,
and each worker view carries its own `repoRoot` — the repository the workspace was
cut from.

`worker run` creates a fresh workspace by default. Use `--workspace <id>` to
co-locate intentionally or `--no-workspace` to use the active workspace. Without
`--detach`, it waits for a completed/question/timeout/error outcome. With
`--detach`, it returns after prompt uptake is confirmed. The base ref is verified
in the resolved repository first, so a ref that does not exist there fails with
the repo path named rather than a bare `not a valid object name`.

#### Detached uptake

With `--detach`, dispatch waits for the tab's first paint before writing (a
still-booting TUI buffers the payload but drops the submitting `\r`), then waits
for the `working` transition. If none arrives it re-checks the live activity,
sends one more `\r`, and waits again. Outcomes:

- `status: "dispatched"` — uptake confirmed. `uptake.resubmits` says whether the
  retry was needed.
- `status: "pending-submit"` (exit `11`) — the prompt is sitting in the composer
  unsubmitted. The worker is healthy; recover with `aimux worker submit <name>`,
  do **not** re-dispatch.

`--uptake-timeout <ms>` widens the confirmation window (default 15000). It is
independent of `--timeout`, which caps the turn itself.

`worker submit <name>` submits whatever is already in a worker's composer and
blocks until the turn starts — the awaitable form of
`tab send <tab> "<CR>" --keys`.

`worker prompt --replace` clears the composer (`<C-u>`) before writing. Use it
whenever a human may have typed into the worker's tab: without it the write is
appended to whatever is already there, concatenating both into one instruction.

`worker list` always reports the `project` it queried, so an empty `workers`
array reads as "none here" rather than "the fleet died".
`worker list --all-projects` answers "are my workers really gone?" in one call
and labels each worker with its owning project.

Addressing a worker by name keeps working when the active project moves: if the
name isn't in the resolved project, aimux searches the catalog and binds to the
project that actually owns it. With an explicit `--project` /
`AIMUX_PROJECT` the pin is respected, but the error names the project that
does hold the worker.

`worker stop --cleanup-workspace` removes only aimux-created, unshared
workspaces. Dirty workspaces require `--force`; primary and external workspaces are
never removed by this command. It works headlessly (no attached UI required);
tab-close and workspace-removal are reported independently (`closed`,
`closeError`, `workspaceRemoved`) so a failure in one never strands the other.

`worker doctor` reports the client version, negotiated daemon protocol and
capabilities, available assistants, model/effort controls, project (including
`source` and `repoRoot`), non-fatal `warnings`, and the packaged orchestrator
skill path.

### Tab commands

#### `aimux tab list`

Lists tabs in the target project.

```
aimux tab list [--verbose] [--project W]
-> { tabs: [{ id, assistant, title, status, activity, command, workspaceId? }],
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
                 [--workspace WT | --new-workspace[=<name>] [--base R] [--branch B]]
                 [--project W]
-> { tabId, assistant, title, command, cwd, model, effort,
     workspaceId, path, branch, name }   # workspace fields null when none
```

- **cwd** defaults to the resolved workspace's path (so a worker spawned into a
  workspace actually runs inside it); an explicit `--cwd` overrides.
- **`--command`** overrides the assistant's default binary entirely.
- **`--model` / `--effort`** map to the assistant's own flags (claude
  `--model`/`--effort`; codex `--model` + `-c model_reasoning_effort=…`; opencode
  `--model` only; grok `-m` / `--effort`; kimi `--model` only). They append to the resolved base command and **cannot** be
  combined with `--command`. Values aren't validated by aimux — a bad one makes
  the worker CLI fail at startup.
- **customCommands**: the base command is resolved as
  `--command` > the project's persisted `customCommands[assistant]` > the
  builtin default, so CLI-spawned tabs inherit e.g. `claude
--dangerously-skip-permissions` exactly like the UI. `--command claude` is the
  bypass.
- **`--workspace WT`** pins the tab to an existing workspace id (co-locate several
  tabs in one tree); without it the project's active workspace is used.
- **`--new-workspace[=<name>]`** creates a fresh workspace (branch `aimux/<name>`
  off `--base`, default HEAD) and runs the tab in it, emitting the workspace's
  `path`/`branch`/`name`. A bare flag derives the name; the `=` form names it.
  Mutually exclusive with `--workspace` and `--cwd`; `--base`/`--branch` require
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
aimux tab send <tabId> --enter                         # submit only (empty payload)
aimux tab send <tabId> --enter --await-submit <text>   # + confirm uptake
aimux tab send <tabId> --keys "<CR>" --await-submit    # submit a pending prompt, awaited
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

An empty payload with `--enter` is a valid submit-only operation ("press Enter"):
the zero-length write is skipped and only the `\r` is sent.

`--await-submit` blocks after the write until the tab transitions to `working` —
i.e. the receiving CLI accepted the prompt — or `--await-timeout` ms elapse
(default 15000). It requires something that submits: either `--enter` or `--keys`
(where the chord itself carries the submit, e.g. `"<CR>"`). Uptake is advisory: a
missed transition still exits 0 with `uptake.confirmed: false`. For a full
submit→turn-end round-trip, prefer `tab run` below; for a named worker, prefer
`worker submit`.

`<C-u>` clears the composer line. Send it before a prompt (or use
`worker prompt --replace`) when the tab may contain text you did not write.

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

Sets the active tab in the project.

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

### Project commands

#### `aimux project list`

Lists the profile's project catalog.

```
aimux project list -> { projects: [{ id, name, projectPath, lastOpenedAt, ... }] }
```

#### `aimux project show`

Shows the resolved project (defaults to the most recently opened).

```
aimux project show [--project W]
-> { id, name, projectPath, activeWorkspaceId, workspaces: [...] }
```

#### `aimux project create`

Creates a project. When a UI is attached the daemon relays the request to
the UI's reducer (preserving the live snapshot); headless, it writes the
catalog directly.

```
aimux project create <name> [--project <path>] [--switch]
                              [--wait] [--timeout N]
-> { name, projectPath, switch, sessionId? }
```

- `--switch` immediately makes the new project active.
- `--wait` requires `--switch`; blocks until the daemon broadcasts
  `projectSwitched`. Timeout defaults to 30 s.

#### `aimux project switch`

Switches the running UI (or bumps `lastOpenedAt` when headless).

```
aimux project switch <name|id> [--wait] [--timeout N]
-> { name, targetSessionId }
```

`--wait` subscribes to `projectSwitched` before sending the request, so
the both-paths case (UI attached vs. headless) is race-free.

The daemon validates the target against the catalog before broadcasting —
an unknown id fails the CLI fast rather than hanging on `--wait`.

#### `aimux project close`

Removes a project from the catalog. UI-attached path uses the UI's delete
handler; headless path writes the catalog directly.

```
aimux project close <name|id>
-> { closedSessionId, name }
```

### Workspace commands

Workspaces are per-project git worktrees, cross-checked against `git
workspace list` on inspection.

#### `aimux workspace list`

Lists workspaces for the project. `gitTracked` flags catalog rows that git
no longer sees (prunable / vanished).

```
aimux workspace list [--project W]
-> { projectId, activeWorkspaceId, workspaces: [{ id, name, branch, path,
     repoRoot, source, gitTracked, createdByAimux }] }
```

#### `aimux workspace create`

Creates a git worktree AND registers it in the catalog. If the daemon
rejects the registration, the on-disk workspace is rolled back so `list`
never surfaces an orphan.

```
aimux workspace create --name N [--branch B] [--base ref] [--project W]
-> { id, name, branch, path, repoRoot }
```

- `--branch` defaults to `aimux/<name>`.
- `--base` defaults to `HEAD`.

#### `aimux workspace remove`

Removes a workspace. Git side runs first (respects the dirty-check unless
`--force`), then the catalog record is dropped. Refuses to remove the
primary workspace.

```
aimux workspace remove <id|path> [--force] [--project W]
-> { id, name, path }
```

### `aimux skill`

Where the skills aimux ships actually live. An agent asked to author a plugin
needs the directory before it can read anything in it, and the path depends on
how aimux was installed.

```
aimux skill list
-> { skills: [{ id, summary, path, present }] }

aimux skill path <id>
-> { id, path, summary }
```

### `aimux plugin`

Manages the plugin kernel (`docs/developer/plugins.md`). The CLI process never
loads plugin code: these verbs read manifests and the registry, and hand
anything needing a live kernel to the daemon, which reloads its own halves and
forwards the same instruction to every attached UI.

```
aimux plugin new <id> [--ui] [--daemon] [--exec] [--dir PATH]
-> { id, root, shapes, created: [...files], next: [...commands] }

aimux plugin list
-> { plugins: [{ id, name, version, source, root, enabled, enabledFrom,
                 halves, state: { ui, daemon }, error, hasConfigSchema, config }],
     running: [{ id, host, state, revision, effects, error?, missing? }] | null,
     issues: [string], daemon }

aimux plugin link <path> [--no-build]
-> { id, version, root, halves, linked, build, daemon }

aimux plugin unlink <id>
-> { id, root, unlinked, daemon }

aimux plugin install <owner/repo[/subdir]> [--yes] [--dry-run]
-> { id, version, origin, root, installed, build, daemon }

aimux plugin uninstall <id> [--purge]
-> { id, removed, uninstalled, configKept, daemon }

aimux plugin enable <id>
aimux plugin disable <id>
-> { id, enabled, source, storedIn, shadowedBy, daemon }

aimux plugin config <id>
-> { id, name, version, source, enabled, enabledFrom,
     fields: [{ key, type, label, description?, required, secret,
                default?, value, isSet, origin, shadowedBy? }],
     extraKeys }

aimux plugin set <id> <key> <value> [--value-stdin]
-> { id, key, value, written, shadowedBy, daemon }

aimux plugin unset <id> <key>
-> { id, key, removed, value, origin, daemon }

aimux plugin show <id> [--lines N] [--level debug|info|warn|error]
-> { id, name, version, source, root, enabled, enabledFrom, halves,
     state: { ui, daemon }, errors, missing, issues, config, extraKeys,
     paths, log, daemon }
-> { id, enabled, daemon }

aimux plugin reload [id]
-> { id, reloaded, result }

aimux plugin log <id> [--lines N] [--level debug|info|warn|error]
-> { id, path, entries: [{ at, host, level, message, data? }] }

aimux plugin doctor [path-or-id] [--no-apply] [--no-types]
-> { ok, id, version, root, manifest, issues, halves, types, aimuxVersion }

aimux plugin commands
-> { commands: [{ pluginId, id, title, command, contexts? }] }

aimux plugin exec <plugin-id> <command-id> [args...]
-> { pluginId, commandId, exitCode, stdout, stderr, timedOut }
```

`enable`, `disable`, `set` and `unset` work on **every** plugin — built-in,
linked, installed, or declared in `aimux.config.ts` — because the state goes
into the registry's `overrides` block, keyed by id, rather than into a row only
some of them have.

`enabledFrom` (`default` / `registry` / `config`) is the field to read before
acting: a `disable` that `aimux.config.ts` will overrule at the next launch is
not a disable. When a write is outranked, `shadowedBy` names the file, the write
still happens, and stderr says so — exit stays `0`.

`set` coerces the value against the manifest's declared type and refuses a key
the manifest does not declare, listing the ones it does. `resolvePluginConfig`
would let an undeclared key through silently, and a typo that lands somewhere no
plugin reads is the worst outcome available.

None of `enable`, `disable`, `set`, `unset`, `list` or `show` starts a daemon
that is not running: the write is durable and the next launch picks it up. They
report `"daemon": "unreachable"` and still exit `0`.

`commands` and `exec` are the manifest-declared subprocess half: a plugin whose
manifest has `commands[]` and no `entries` needs no TypeScript at all. The
spawn happens in the daemon, so the same command is reachable from an event or
a keybinding and not only from a shell, and the command's exit code becomes the
CLI's own.

A plugin can also contribute its own group and verbs — `aimux <group> <verb>`.
Those run in the daemon too; the CLI learns their flags and args from a sidecar
the daemon writes, so `--help`, argument validation and TAB completion work
without the CLI loading any plugin code.

`link` registers a directory in place and watches it for edits; `install`
clones into `<profile>/plugins/<id>` and owns that copy. `unlink` and
`uninstall` are therefore not interchangeable, and each refuses the other's
plugins rather than deleting a directory it does not own.

`install` prints the manifest and the `build` argv on stderr and then refuses
without `--yes`: build steps run arbitrary commands with your privileges, and
there is no sandbox. `--dry-run` prints the manifest and stops.

`doctor` is the author loop. It validates the manifest field by field, bundles
each half, applies it against a throwaway context, and reports what that apply
registered — effects, events, RPC verbs, services — plus `tsc --noEmit` when
the plugin ships a tsconfig. Exit 3 when anything failed. It is the one verb
that executes plugin code; nothing it runs touches the running aimux.

Secrets declared with `"secret": true` in the manifest are printed as
`<secret>` by `list`.

## JSON Output Conventions

- One JSON object per invocation on stdout (`tab wait` and `tab tail` are
  NDJSON streams).
- No prose, no ANSI. Errors write a human-readable line to stderr AND a
  JSON object to stdout (`{ error, kind }`).
- Timestamps in streams (`ts`) are milliseconds since the CLI attached.

## Profile Awareness

Runtime-oriented commands use the active profile namespace. That affects:

- config file resolution for the TUI startup path
- project and snippet catalogs
- daemon socket path
- terminal-manager socket path

Commands such as `aimux version` and `aimux --help` exit early and do not
need to load profile-scoped runtime state. See `runtime-paths.md` for the
exact path rules.
