# Hot-Migration Plan — daemon protocol bumps without killing PTYs

Goal: ship a new aimux binary (UI, CLI, or daemon) that introduces wire-level
changes without forcing the user (or a CI/agent loop) to lose live PTY
sessions. Today every minor protocol bump destroys the terminal-manager, and
that takes every running Claude/Codex/opencode session with it.

## Current pain — diagnostic

Two protocols, two restart axes:

| Link              | File                               | Restarting the producer kills... |
| ----------------- | ---------------------------------- | -------------------------------- |
| UI / CLI ↔ daemon | `src/ipc/protocol.ts` (v10)        | Just connections. PTYs survive.  |
| daemon ↔ TM       | `src/ipc/manager-protocol.ts` (v8) | All PTYs.                        |

The current breaking-update flow (`src/session-backend/bootstrap.ts:217-281`):

1. UI does `hello`, finds the daemon speaks a version it doesn't.
2. UI calls `stopTerminalManager()` — explicitly kills the TM
   ("the new daemon reconnects to the still-running old terminal-manager and
   the breaking protocol mismatch persists").
3. UI restarts the daemon.
4. New daemon spawns a new TM.
5. Every PTY is gone.

Root cause: **`MIN_VERSION` is bumped in lockstep with `MAX_VERSION`** on
every wire change (`src/ipc/protocol.ts:17`, `src/ipc/manager-protocol.ts:35`).
There is never any overlap between versions, so an old daemon can never serve
a new client (and vice-versa). The "negotiation" is theatrical.

Also: the two protocols bump together by reflex — even when only the
daemon↔UI wire changes, MIN on the TM protocol is raised to "force a fresh
TM". This is what makes a UI-only change rip down PTYs.

## Strategy — three concentric rings

### Ring 1: stop the bleeding (additive protocol discipline)

Make every change **additive by default**. Only bump `MIN` when a field is
genuinely impossible to keep parsing (true semantic break). Everything else:

- New optional field on a request/response → MAX bumps, MIN stays.
- New event type → MAX bumps, MIN stays. Old clients ignore unknown events.
- New request type → MAX bumps, MIN stays. Old daemons return
  `error: "unknown request"`; new clients gate the call on the negotiated
  version.
- Removed field → deprecate, don't delete. Stop _reading_ it long before
  raising MIN past the version where it disappeared.

Convention: every release advertises a **capability set**, not just a number.
Negotiate features explicitly rather than implicitly via version comparison.

```ts
interface ProtocolHelloResult {
  minVersion: number
  maxVersion: number
  selectedVersion: number
  processVersion: string
  capabilities: string[] // NEW — e.g. ["listTabs", "thinAttach", "activeTabChanged"]
}
```

Clients check `capabilities.includes("thinAttach")` before sending it. This
removes the temptation to bump MIN whenever the wire grows.

### Ring 2: decouple the two protocols

Two rules, enforced in a CI check:

- **TM protocol bumps only when the TM's behaviour changes.** A UI-side
  change must not touch `manager-protocol.ts` and must not call
  `stopTerminalManager`.
- **Daemon protocol bumps never trigger a TM restart** unless explicitly
  justified in the PR description. Without TM restart, PTYs survive.

The CI check is mechanical: any commit that touches `manager-protocol.ts`
must include a release note line; any commit that calls `stopTerminalManager`
outside `restartTerminalManager.ts` must include an "I am killing PTYs"
comment that the linter flags.

After this, the typical wire change becomes daemon-only: new daemon spawns,
PTYs stay alive in the still-running TM, all sessions reattach.

### Ring 3: daemon hot-reexec (zero-downtime daemon swap)

Even when the daemon binary changes, we can avoid the restart-roundtrip
visible to clients.

Mechanism:

1. Old daemon is told to **drain**: SIGUSR2 (or an IPC `prepareReexec`).
2. Old daemon stops accepting new connections, finishes in-flight requests,
   keeps its TM connection alive.
3. Old daemon writes a small state file
   (`runtime/daemon.handoff.json`) with: TM socket version, attached
   sessions and tabIds it knows about, hookServer URL.
4. Old daemon `rename()`s its socket away (`daemon.sock` → `daemon.old.sock`),
   removes the live socket.
5. Spawn the new daemon binary. It reads the handoff file, binds
   `daemon.sock`, reconnects to the existing TM, rebuilds its tab registry
   from `listSessions/listTabs` on the TM.
6. Old daemon exits cleanly. Clients reconnect (they already have
   reconnection logic) and pick up where they were — PTYs untouched, viewport
   restored from the TM's first `tabRender` after reattach.

What this needs to work:

- **TM protocol stability** (Ring 2) — the new daemon must speak the existing
  TM's protocol or the old TM stays running and the gymnastics are wasted.
- **Per-session viewport on the TM side** — already true; the TM holds the
  emulator state, the daemon is a cache. Tab registry rebuild is cheap.
- **Client reconnection grace** — UI and CLI already encode/decode framed
  JSON over a socket that can drop. Just need a deterministic reconnect
  policy (200 ms backoff × 5, then surface to user).
- **PID + version sidecar** — `runtime/daemon.pid`, `runtime/daemon.version`.
  Lets a freshly-launched binary detect "the running daemon is older than me"
  and trigger reexec instead of brute restart.

### (Stretch) Ring 4: TM hot-reexec via FD passing

The hard case: the TM binary itself changes and we want PTYs to survive.

Mechanism: SCM_RIGHTS over a Unix socket. The old TM passes every PTY master
FD, plus a serialised emulator-state-per-tab blob, to the new TM. The new TM
adopts the FDs, restores emulator state, resumes broadcasting.

Bun does not expose `sendmsg`/`SCM_RIGHTS` natively today — would need a
small native shim or a child Node process to broker the handoff. High effort,
low frequency (TM changes are rare). Mark as Phase 3, after Rings 1–3 have
proven the additive discipline holds.

## Phased rollout

| Phase | Deliverable                                                                                                                                                                                                                                            | Risk                                                                                  |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| 0 ✅  | Audit current MIN bumps; reclassify which were truly required. Document the additive contract in `src/ipc/README.md`.                                                                                                                                  | None — paperwork.                                                                     |
| 1 ✅  | Add `capabilities: string[]` to `hello` results on both protocols. Migrate the v11 CLI work (`cli-control-plan.md`) to use capability gates instead of bumping MIN.                                                                                    | Tiny — capability list is additive.                                                   |
| 2 ✅  | Lint rule + CI check: forbid MIN bump in the same commit as MAX bump unless the PR body contains `BREAKING: <reason>`. Forbid `stopTerminalManager` outside the dedicated restart-terminal-manager command.                                            | Low — discipline, no runtime change.                                                  |
| 3 ✅  | Daemon hot-reexec: drain protocol message, handoff file format, sidecar PID/version files, reconnect policy in `DaemonClient` and the UI `RemoteSessionBackend`. Aimux update path uses reexec by default; full restart only when TM protocol changed. | Medium — touches startup and update flow. Roll out behind `AIMUX_HOT_REEXEC=1` first. |
| 4     | TM hot-reexec (FD passing). Native shim via Bun FFI or Node sidecar.                                                                                                                                                                                   | High — defer until justified.                                                         |

Phases 0–2 landed together: the additive-contract README is at
`src/ipc/README.md`, both `helloResult` payloads now carry
`capabilities: string[]` (wire-back-compat: legacy peers without the
field are normalised to `[]` at parse time), the manager-client's
`setBroadcastEnabled` gate is now capability-driven instead of
version-gated, and the discipline rules are enforced by
`scripts/check-protocol-discipline.ts` (wired as `bun run lint:protocol`
and a CI step).

## Concrete entry points to change

- `src/ipc/protocol.ts:17` — split MIN and MAX semantics, add capabilities to
  `ProtocolHelloResult`.
- `src/ipc/manager-protocol.ts:35` — same, plus the rule "do not raise MIN
  unless the TM cannot decode the older wire".
- `src/session-backend/bootstrap.ts:217-281` — replace
  `stopTerminalManager` + `restartDaemon` with a reexec request when the only
  mismatch is on the daemon protocol; full restart only when TM is the
  problem.
- `src/daemon/daemon.ts` — implement drain + handoff file + SIGUSR2 handler.
- `src/platform/daemon-control.ts` — `spawnDaemonReexec(handoff)` next to
  the existing `spawnDetachedIpcDaemon`.
- `src/restart-daemon.ts` — soft-restart path that prefers reexec.

## Acceptance criteria

- Bumping a daemon protocol field in dev (`bun run dev`) while a tab is
  running a Claude session keeps the session alive and visible after the
  update lands. Manual repro: start a long `sleep` in a terminal tab, run
  `bun run release-style-bump`, observe the tab still ticking.
- The CI lint blocks a synthetic PR that raises MIN without a `BREAKING:`
  marker.
- `aimux restart-daemon` invoked on a tree with no protocol changes performs
  a reexec (PTYs untouched), while the same command on a tree with a `BREAKING`
  marker performs the legacy full restart.

## Manual repro for Ring 3

The hot-reexec path is gated by `AIMUX_HOT_REEXEC=1` so the legacy
breaking-update flow stays the default until we trust it. To exercise the
new path end-to-end:

```sh
# Terminal A — start aimux with reexec on, attach a long-running PTY
AIMUX_HOT_REEXEC=1 bun --watch src/index.tsx
# (start a tab running `while true; do date; sleep 1; done`)

# Terminal B — trigger the swap
AIMUX_HOT_REEXEC=1 bun run src/index.tsx restart-daemon
# Expect:
#   Negotiating hot-reexec with daemon (pid N)…
#   Spawning successor daemon…
#   Daemon hot-reexec complete on …/daemon.sock. PTYs preserved.
```

Watch the tab in Terminal A: the date counter must not pause. If you see
"Hot-reexec not available; falling back to full restart." the running
daemon was built before the `hotReexec` capability landed — restart it
once via the legacy path so the capability is advertised.

Out-of-band variant: `kill -USR2 <daemon-pid>` triggers the same drain
without a protocol partner — useful when debugging from outside the
aimux process tree. The successor daemon will not be spawned for you in
that case; signal-based drain is for poke-and-pry sessions, not regular
upgrade flows.

## Open questions

- Should the **CLI commands** (`cli-control-plan.md`) ever trigger a reexec
  on their own, or only the UI? Suggested: CLI never reexecs; it surfaces the
  mismatch and exits with code 4. The UI keeps ownership of the upgrade UX.
- **Profile isolation** — reexec sidecars are per-profile (runtime dir
  already partitions). Confirm no cross-profile leakage when running multiple
  profiles concurrently.
- **Update.ts interaction** — `aimux update` swaps the binary. After the
  binary is replaced, the next `aimux` invocation triggers reexec, not the
  update process itself. Keeps `update` simple.
