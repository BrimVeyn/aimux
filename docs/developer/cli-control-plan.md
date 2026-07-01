# CLI Control Plan — Tier 1

Goal: expose aimux internals via CLI so an AI agent can drive the multiplexer
headlessly (create agents/tabs, inject prompts, snapshot output, wait for
status) while a UI session, if present, hot-updates on the same events.

## Principles

- **Profile-aware for free.** Reuse `getRuntimeProfile()` and
  `getIpcDaemonSocketPath()`. `AIMUX_PROFILE=dev aimux tab list` already talks
  to the dev daemon's socket — no extra wiring.
- **Headless first.** If the daemon or terminal-manager are down, spawn them
  via `spawnDetachedIpcDaemon` / `spawnDetachedTerminalManager`. The UI is
  never required.
- **Hot-update.** The daemon already broadcasts `tabRender` / `tabStatus` to
  every socket attached to a sessionId. A CLI mutation on the same workspace
  reaches the UI through that broadcast — no extra plumbing.
- **JSON pure.** Every command writes one JSON object on stdout (or an
  NDJSON stream for `wait` / `tail`). No prose, no ANSI.
- **Exit codes:** `0` success, `2` usage error, `3` runtime error, `4` daemon
  unreachable, `124` timeout.

## Module layout

```
src/cli/
  index.ts              # entrypoint: parse argv, run registry
  registry.ts           # CliCommand[] -> resolver (group + verb)
  context.ts            # CliContext: client, args, flags, profile, stdout
  client/
    daemon-client.ts    # connect + hello + attach + send + decode events
    bootstrap.ts        # ensure daemon + TM up (spawn + healthcheck)
    workspace-resolver.ts
  output.ts             # writeJson, writeNdjson, writeError
  flags.ts              # shared flag parsers (--workspace, --tail, ...)
  snapshot-render.ts    # TerminalSnapshot -> string[] (plain text)
  commands/
    tab/
      list.ts
      create.ts
      send.ts
      focus.ts
      close.ts
      snapshot.ts
      wait.ts
    workspace/
      list.ts
      show.ts
```

One file per command — adding a command is: create file + register it.

## `CliCommand` interface

```ts
export interface CliCommand {
  group: string // "tab"
  verb: string // "list"
  summary: string
  flags: readonly FlagSpec[]
  args: readonly ArgSpec[]
  run(ctx: CliContext): Promise<number> // exit code
}

export const COMMANDS: CliCommand[] = [
  tabList,
  tabCreate,
  tabSend,
  tabFocus,
  tabClose,
  tabSnapshot,
  tabWait,
  workspaceList,
  workspaceShow,
]
```

`registry.resolve(['tab', 'list'])` returns the matching command. No external
framework — `Bun.argv` + a ~50-line flag parser is enough.

## Entrypoint branching (`src/index.tsx`)

One block near the top, before the UI bootstrap:

```ts
const CLI_GROUPS = new Set(['tab', 'workspace'])
if (CLI_GROUPS.has(process.argv[2])) {
  process.exit(await (await import('./cli')).runCli(process.argv.slice(2)))
}
```

`await import` keeps cold-start cost out of the UI path.

## `DaemonClient`

Wraps `connect()` + `MessageDecoder` + `encodeMessage` from `src/ipc/protocol.ts`:

```ts
class DaemonClient {
  static async connect(opts?: { autostart?: boolean }): Promise<DaemonClient>
  async hello(): Promise<ProtocolHelloResult>
  async attach(sessionId, cols, rows, opts?: { thin?: boolean }): Promise<AttachResult>
  async request<T extends ClientRequest['type']>(type: T, payload): Promise<ServerResponse>
  on(event: 'tabRender' | 'tabStatus' | ..., cb): Unsubscribe
  async close(): Promise<void>
}
```

`autostart: true` (default): if the socket is missing or handshake fails, spawn
the daemon and retry (300 ms backoff × 10).

## Protocol additions (bump to v11)

Two changes to `src/ipc/protocol.ts`:

| New                                                 | Why                                                                                           |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `listTabs { sessionId }` -> `{ tabs, activeTabId }` | Read-only without `attach` (avoids unintended PTY resize when a UI is also attached).         |
| `attach.thin?: boolean`                             | When `true`, the daemon does not call `manager.resize`. The UI stays the dimension authority. |

`createTab` should also accept `cols/rows = 0` meaning "use the session's
current size" — a small TM patch.

Without these, `aimux tab send` from an 80×24 terminal would resize a PTY a UI
is rendering at 200×60. Mandatory for headless ↔ UI coexistence.

## Workspace resolution

Every command takes `--workspace <name|id>`. Without it, the "active"
workspace is the catalog entry with the most recent `lastOpenedAt`. Helper in
`workspace-resolver.ts`, reads via `loadSessionCatalog()`. Clear error if the
catalog is empty.

## Tier 1 surface

```
aimux tab list [--workspace W]
-> { tabs: [{ id, assistant, title, status, activity, command, worktreeId? }], activeTabId }

aimux tab create --assistant <id> [--title T] [--cwd .] [--workspace W]
-> { tabId, assistant, command }

aimux tab send <tabId> <text>
aimux tab send <tabId> --enter <text>      # appends \r
aimux tab send <tabId> --keys "<C-c>"      # chord parser -> bytes
aimux tab send <tabId> --stdin             # read text from stdin
-> { ok: true, bytesWritten: N }

aimux tab focus <tabId>                    -> { ok: true }
aimux tab close <tabId>                    -> { ok: true }

aimux tab snapshot <tabId> [--tail N]
-> { tabId, cols, rows, lines: [...], cursor: { row, col, visible } }

aimux tab wait <tabId> --status idle [--timeout 30000]
-> NDJSON stream of { ts, status }, exits 0 when reached, 124 on timeout

aimux workspace list   -> { workspaces: [{ id, name, projectPath, lastOpenedAt }] }
aimux workspace show [--workspace W]
```

Shared flags (`--workspace`, `--profile` override, `--json` no-op for
consistency) live in `flags.ts`.

## `--keys` chord parsing

`<C-c>`, `<Esc>`, `<CR>`, `<Tab>`, `<Up>` — reuse the chord parser already in
`@brimveyn/aimux-config` (`keymap-builder`). One utility:
`chordToBytes(chord: string): Buffer`.

For multi-line prompts, auto-wrap in bracketed-paste (ESC `[200~` ... ESC
`[201~`) so the receiving CLI doesn't interpret newlines as submit.

## Snapshot rendering

`TerminalSnapshot` -> `string[]` by concatenating `span.text` per line. No
ANSI — the agent consumes plain text. Helper in `snapshot-render.ts`.

`tab snapshot` flow: thin-attach, read the initial snapshot in `attachResult`,
optionally wait up to N ms for a `tabRender` if the snapshot is empty, close.

`--tail N` slices the last N non-empty lines.

## Hot-update — no extra code

The daemon already broadcasts to every socket attached to the same session:

- `createTab` CLI -> TM -> `tabRender` -> UI re-renders ✓
- `write` CLI -> PTY -> `tabRender` (output) -> UI ✓
- `closeTab` CLI -> `tabExit` -> UI ✓

Exception: `setActiveTab`. Its result lives in the TM per-session and is only
delivered via the next `attachResult`. Either:

- Add a `activeTabChanged` server event (small change), or
- Leave `tab focus` as best-effort and revisit in Tier 2.

## Implementation order

1. Skeleton — `src/cli/{index,registry,context,output,flags}.ts`, `DaemonClient`,
   `src/index.tsx` branching.
2. Protocol — bump to v11, add `listTabs` + `attach.thin`, daemon handlers,
   TM propagation.
3. Read commands — `workspace list/show`, `tab list`, `tab snapshot`.
4. Mutating commands — `tab create`, `tab send`, `tab close`, `tab focus`.
5. Streaming — `tab wait` (subscribes to `tabStatus`).
6. Tests — one per command with a fake daemon (socket mock + event injection),
   following the pattern in `test/`.

## Open points

- **Protocol bump to v11.** Forces matching binaries; the daemon already
  refuses old clients, so behaviour is the same as today's breaking bumps.
  See `hot-migration-plan.md` for how we want this to stop being the norm.
- **`workspace switch` headless** requires writing the catalog snapshot of
  the current session — not trivial without the UI's reducer. Deferred to
  Tier 2 / a control socket on the UI process.
- **`tab send --keys`** scope: vim-style subset (`<C-x>`, `<Esc>`, `<CR>`,
  `<Tab>`, arrows) + auto bracketed-paste for multi-line text.

## Tier 2 additions

Tier 2 fills the deferred items above and adds streaming output. IPC bumped
to **v12** (additive; MIN stays at 10). New capabilities: `workspaceLifecycle`,
`worktreeLifecycleEvents`, `tabTail`.

### Coordination discipline (UI attached vs. headless)

The UI process has no control socket — it's a pure client of the daemon. So
lifecycle CLI → UI coordination goes through daemon-broadcast events. Every
new workspace/worktree op follows one of two paths at the daemon:

| UI attached? | Path                                                                                                                                                                                |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Yes          | Daemon broadcasts `*Requested` event; UI's `backend-runtime-events.ts` calls the existing side-effect from `session-actions.ts` (owns the live workspace snapshot + catalog write). |
| No           | Daemon writes catalog directly via `src/daemon/catalog-writer.ts`.                                                                                                                  |

Workspace events use a new `broadcastAllVersioned(minVersion, event)` helper
(not `broadcastForSessionVersioned`) because the UI may be attached to a
different session than the one being mutated.

Lifecycle handlers on the UI side run behind a small FIFO promise chain so
back-to-back broadcasts from multiple CLIs can't race the async switch
effect.

### Tier 2 surface

```
aimux workspace create <name> [--project P] [--switch]
-> { name, projectPath, switch }

aimux workspace switch <name|id> [--wait] [--timeout N]
-> { name, targetSessionId }   # with --wait, exits when workspaceSwitched fires

aimux workspace close <name|id>
-> { closedSessionId, name }

aimux worktree list [--workspace W]
-> { workspaceId, activeWorktreeId, worktrees: [...] }
   # each entry includes `gitTracked` to flag catalog rows git no longer sees

aimux worktree create --name N [--branch B] [--base ref] [--workspace W]
-> { id, name, branch, path, repoRoot }
   # git worktree add first, THEN addWorktreeRecord to the daemon

aimux worktree remove <id|path> [--force] [--workspace W]
-> { id, name, path }
   # git worktree remove first (respects dirty-check unless --force), THEN
   # removeWorktreeRecord. Refuses to remove the primary worktree.

aimux tab tail <tabId> [--raw] [--rate-limit-ms N] [--follow-status] [--timeout N]
-> NDJSON stream: { ts, type: 'render'|'exit'|'error'|'status'|'timeout', ... }
   # thin-attach + tabRender subscription
   # exit 0 on tabExit, 3 on tabError, 124 on --timeout
```

### `--wait` on `workspace switch`

The UI dispatches `announceWorkspaceSwitched` after `handleSwitchSessionEffect`
finishes; the daemon relays that as `workspaceSwitched`. `--wait` subscribes
before sending the request so the no-UI path (which the daemon fires
synchronously) isn't missed.

### Test surface

`test/integration/cli-daemon-client.test.ts` was extended with wire tests for
the new requests + `workspaceSwitched` broadcast + `tabRender`/`tabExit`
subscription (the same wiring `tab tail` uses). `test/unit/ipc-protocol-v12.test.ts`
covers parser branches for every new request/event variant.
