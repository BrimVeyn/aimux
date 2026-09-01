# IPC protocols — additive contract

Two wire protocols live in this directory:

| Link                      | File                  | Negotiated by                     | Breaking it kills...                                                                |
| ------------------------- | --------------------- | --------------------------------- | ----------------------------------------------------------------------------------- |
| UI / CLI ↔ daemon         | `protocol.ts`         | `DaemonClient.hello()`            | Client connections. PTYs survive (they live in the TM).                             |
| daemon ↔ terminal-manager | `manager-protocol.ts` | `TerminalManagerClient.connect()` | **Every PTY.** A fresh TM is spawned, the old one dies, every session dies with it. |

The cost asymmetry is the whole reason this document exists. **Touch
`manager-protocol.ts` and you are about to drop every running Claude/Codex
session.** Make sure that's what you want.

## The rule

> A wire change is **additive** by default. `MIN_VERSION` only rises when the
> new daemon literally cannot parse a message a pre-bump peer would send.

`MAX_VERSION` advertises "I know about new things." `MIN_VERSION` declares
"old peers are now unrunnable." These are different operations. The old
`bump-protocol.ts` script bumps both in lockstep — that's correct only for
true semantic breaks, and most wire changes aren't that.

### Decision tree before bumping MIN

```
            Are you adding a field / event / request type?
                              │
              ┌───────────────┴───────────────┐
            yes                              no (removing / repurposing)
              │                              │
   Is the new field required for             │
   correctness on the OLD peer?              Can the old peer still
              │                              decode the bytes the new
       ┌──────┴──────┐                       peer puts on the wire?
      yes           no                       │
       │             │                ┌──────┴──────┐
   bump MIN     keep MIN.            yes           no
                Advertise as a       │             │
                capability.          keep MIN.    bump MIN.
                Gate the new         Deprecate    Write
                wire on              the old      `BREAKING:` in
                `capabilities.       behaviour    the commit body.
                includes(...)`.      and stop
                                     reading it
                                     long before
                                     raising MIN.
```

If the answer to "are you certain old peers cannot decode this?" is "I
think so", treat it as additive. The cost of being wrong (PTYs die) is
much higher than the cost of one stale capability flag.

## Capabilities

Both `helloResult` payloads carry a `capabilities: string[]`. A client
checks `capabilities.includes("featureName")` before sending a request or
relying on an event that the peer might not understand. New features are
introduced as new capability strings, **not** as a MIN bump.

Current capability registries live next to each protocol:

- `src/ipc/protocol.ts` → `IPC_PROTOCOL_CAPABILITIES`
- `src/ipc/manager-protocol.ts` → `MANAGER_PROTOCOL_CAPABILITIES`

To add a new capability:

1. Pick a stable string (kebab/camel — pick one and stay consistent per
   protocol; `manager-protocol` uses camelCase).
2. Add it to the capabilities constant the producing side advertises.
3. On the consuming side, gate calls / event handlers behind
   `helloResult.capabilities.includes("yourCap")`.
4. **Do not** bump MIN. Old peers without the capability will simply not
   see the new behaviour, which is the entire point of the gate.

For unknown request types received by an old peer: the peer replies
`error: "unknown request"`. New clients must treat that as the gate having
been wrong (capability advertised but no handler) and surface a clear
error, not retry forever.

## When MIN must bump anyway

Examples of genuine semantic breaks where MIN must rise in lockstep with
MAX (and `BREAKING:` belongs in the commit body):

- A field changed type (e.g. `cols: number` → `cols: { value: number; cells: number }`).
- A request was removed and its absence is load-bearing (the peer would
  hang waiting for a response).
- Per-line wire framing changed.

The previous lockstep bumps in `protocol.ts` (v9 dropped scroll intent
from resize messages) and `manager-protocol.ts` (v7 added palette indices
to TerminalSpan) qualify because they change the meaning of existing
fields. Most other changes don't.

## TM bumps that aren't really TM bumps

A historical bad pattern: a UI-only feature lands, `manager-protocol.ts`
gets bumped "to force a fresh TM and clear caches." This kills PTYs for
zero benefit. Don't do this. If the TM behaviour didn't change,
`manager-protocol.ts` doesn't get touched.

The lint check in `scripts/check-protocol-discipline.ts` enforces both
rules: MIN bumps require an explicit `BREAKING:` marker, and new callers
of `stopTerminalManager` need explicit approval.

## See also

- `docs/developer/hot-reexec.md` — the additive-contract discipline and the
  daemon hot-reexec swap that keeps PTYs alive across upgrades.
- `docs/reference/cli.md` — the headless control-plane surface that the
  capability mechanism was originally introduced to serve.
