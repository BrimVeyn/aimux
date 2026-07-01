# Hot-reexec — daemon protocol bumps without killing PTYs

This doc describes how aimux ships a new binary — UI, CLI, or daemon —
that introduces wire-level changes without forcing the user (or a CI/agent
loop) to lose live PTY sessions.

## Two protocols, two restart axes

| Link              | File                          | Restart cost                     |
| ----------------- | ----------------------------- | -------------------------------- |
| UI / CLI ↔ daemon | `src/ipc/protocol.ts`         | Connections drop. PTYs survive.  |
| daemon ↔ TM       | `src/ipc/manager-protocol.ts` | Restart takes every PTY with it. |

The daemon is a cache in front of the terminal manager (TM). PTYs live in
the TM, so a daemon swap can preserve them — as long as the TM protocol
doesn't itself require an incompatible restart.

## Additive protocol contract

Every wire change is **additive by default**. Only bump `MIN_VERSION` when
a field is genuinely impossible to keep parsing (a true semantic break).
Everything else:

- New optional field on a request/response → `MAX` bumps, `MIN` stays.
- New event type → `MAX` bumps. Old clients gate reception on capability;
  the daemon only sends the event to peers that negotiated a compatible
  version.
- New request type → `MAX` bumps. Old daemons return
  `error: "unknown request"`; new clients gate the call on a capability.
- Removed field → deprecate, don't delete. Stop **reading** it long before
  raising `MIN` past the version where it disappeared.

Every release advertises a **capability set** in the `hello` handshake,
not just a version number. Clients check
`capabilities.includes("thinAttach")` before sending a new-request, which
removes the temptation to bump `MIN` whenever the wire grows.

```ts
interface ProtocolHelloResult {
  minVersion: number
  maxVersion: number
  selectedVersion: number
  processVersion: string
  capabilities: string[] // ["hotReexec", "listTabs", "thinAttach", "tabTail", ...]
}
```

Legacy peers omit `capabilities`; the parser normalises the missing field
to `[]`, so consumers can safely call `.includes(...)` on it.

## Protocol decoupling

Two rules, enforced by `scripts/check-protocol-discipline.ts` (run via
`bun run lint:protocol` and CI):

- **TM protocol bumps only when the TM's behaviour changes.** A UI-side
  change must not touch `manager-protocol.ts` and must not call
  `stopTerminalManager`.
- **Daemon protocol bumps never trigger a TM restart** unless explicitly
  justified in the PR description. Without TM restart, PTYs survive.

After this rule set, the typical wire change becomes daemon-only: the new
daemon spawns, PTYs stay alive in the still-running TM, and every client
reattaches.

## Daemon hot-reexec (zero-downtime daemon swap)

Even when the daemon binary changes, the restart-roundtrip is invisible to
clients — the socket briefly changes hands, but no reconnect churn hits the
UI beyond a debounced reattach.

Mechanism:

1. Old daemon is told to **drain**: `SIGUSR2` (out-of-band poke-and-pry
   flow), or an IPC `prepareReexec` request (the regular upgrade path).
2. Old daemon stops accepting new connections, finishes in-flight
   requests, keeps its TM connection alive.
3. Old daemon writes a small state file (`runtime/daemon.handoff.json`)
   with: TM socket version, attached sessions and tabIds it knows about,
   hookServer URL.
4. Old daemon `rename()`s its socket away (`daemon.sock` →
   `daemon.old.sock`) and removes the live socket.
5. The freshly-spawned daemon binary reads the handoff file, binds
   `daemon.sock`, reconnects to the existing TM, and rebuilds its tab
   registry from `listSessions`/`listTabs` on the TM.
6. Old daemon exits cleanly. Clients reconnect (they already have
   reconnection logic) and pick up where they were — PTYs untouched,
   viewport restored from the TM's first `tabRender` after reattach.

What this needs:

- **TM protocol stability** — the new daemon must speak the existing TM's
  protocol, or the old TM stays up and the gymnastics are wasted.
- **Per-session viewport on the TM side** — already true; the TM holds
  the emulator state, the daemon is a cache. Tab registry rebuild is
  cheap.
- **Client reconnection grace** — UI and CLI already encode/decode framed
  JSON over a socket that can drop. Reconnect policy: 200 ms backoff × 5,
  then surface to the user.
- **PID + version sidecar** — `runtime/daemon.pid`, `runtime/daemon.version`.
  Lets a freshly-launched binary detect "the running daemon is older than
  me" and trigger reexec instead of a brute restart.

## CLI + reexec interaction

The headless CLI commands (see `docs/reference/cli.md`) never trigger a
reexec on their own. They surface a version mismatch and exit with code
`4` (daemon unreachable). The UI keeps ownership of the upgrade UX so a
scripted `aimux tab send` never mutates the running daemon binary as a
side effect.

## Manual repro

Hot-reexec is on by default once the daemon advertises the `hotReexec`
capability. To exercise the path end-to-end:

```sh
# Terminal A — start aimux, attach a long-running PTY
bun --watch src/index.tsx
# (in the TUI: start a tab running `while true; do date; sleep 1; done`)

# Terminal B — trigger the swap
bun run src/index.tsx restart-daemon
# Expect:
#   Negotiating hot-reexec with daemon (pid N)…
#   Spawning successor daemon…
#   Daemon hot-reexec complete on …/daemon.sock. PTYs preserved.
```

Watch the tab in Terminal A: the date counter must not pause. If you see
"Hot-reexec not available; falling back to full restart." the running
daemon predates the `hotReexec` capability — restart it once via the
legacy path so the capability is advertised on the next boot.

Out-of-band variant: `kill -USR2 <daemon-pid>` triggers the drain without
a protocol partner — useful when debugging from outside the aimux process
tree. The successor daemon is not spawned for you in that case; signal-
based drain is for poke-and-pry sessions, not regular upgrade flows.

## TM hot-reexec (future work)

The hard case: the TM binary itself changes and we want PTYs to survive.
The mechanism is `SCM_RIGHTS` over a Unix socket — the old TM passes every
PTY master FD, plus a serialised emulator-state-per-tab blob, to the new
TM.

Bun does not expose `sendmsg`/`SCM_RIGHTS` natively today, so this would
need a small native shim or a child Node process to broker the handoff.
High effort, low frequency (TM changes are rare); the additive discipline
above keeps the pressure off this path until it's genuinely required.
