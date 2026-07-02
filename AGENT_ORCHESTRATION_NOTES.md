# aimux — agent-orchestration notes

Findings from driving the `aimux` CLI control plane as an external orchestrator
(spawning/supervising parallel Claude workers through a plan). Untracked file —
commit it if you want it kept; releases `git clean` the tree.

## Bugs — all resolved ✅

| #   | Bug                                                                                                                                                         | Fixed in           | Verified         |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ---------------- |
| —   | `worktree create` ENOENT on a repo's first worktree (repo-scoped parent `realpath()`d before creation)                                                      | 1.18.3 (`441bb70`) | ✅ CLI           |
| 2   | `tab send --enter` didn't submit a bracketed paste (trailing `\r` folded into the paste buffer → prompt staged, worker stuck idle)                          | 1.18.4 (`e7492a2`) | ✅ CLI           |
| 1   | CLI-spawned tabs invisible after switching the UI to their workspace (`attachFromSnapshot` rebuilt tab list from the snapshot, dropping live-registry tabs) | 1.18.4 (`976a98d`) | ⏳ needs eyes-on |

Notes on the fixes:

- **Bug 2 fix is exactly right** — deferring the `\r` to a separate settled write
  _only_ for bracketed pastes (plain text / chords keep an immediate Enter) is
  the minimal correct fix. `PASTE_SUBMIT_SETTLE_MS = 50` worked in testing; if
  flakiness ever shows on a loaded machine, it's the knob to bump.
- **Bug 1 fix matches the diagnosis** — making the registry authoritative for
  membership and appending live tabs the snapshot lacks. Only remaining check is
  visual: switch the UI to a workspace where a sibling CLI spawned a tab and
  confirm it renders (CLI can't observe the render). A discoverability nicety
  still open: a sidebar badge/count when a _non-active worktree_ holds tabs, so
  orchestrated workers in other worktrees are visible without hunting.

No new bugs surfaced in the 1.18.4 re-run: 3 parallel Claude workers, each in its
own worktree, all submitted, ran, and merged green (8 tests pass).

## Suggestions — all shipped in protocol v13 ✅

These let an orchestrator drop its last screen-scraping heuristics. Every one is
now implemented as an **additive, capability-gated** wire change (protocol v13,
`MIN` still 10 — old peers keep working). The `aimux-orchestrator` skill has been
rewired onto them; the pre-v13 workarounds survive only as documented fallbacks.

| #   | Suggestion                                        | Shipped as                                                                                                                                                                                                                                                                                                                                    | Capability                         |
| --- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| 1   | `turnComplete` / `idleSince` event                | `tabTurnComplete` broadcast — fires once `idle` holds for the settle window (`AIMUX_TURN_SETTLE_MS`, default 1500ms). Retires the `await.sh` settle-poll.                                                                                                                                                                                     | `turnLifecycle`                    |
| 2   | structured `question` / `permissionRequest` event | `tabQuestion` broadcast — `{ kind, prompt, options? }` captured on the `→ waiting-input` edge. Prompt text is authoritative; options are best-effort per-CLI. Retires the `snapshot`-scrape.                                                                                                                                                  | `questionEvents`                   |
| 3   | submit acknowledgement                            | `aimux tab send --enter --await-submit` — blocks until the tab transitions to `working`, reports `uptake:{confirmed,ms}`. Retires the standalone `tab wait --status working` uptake check.                                                                                                                                                    | (uses existing `tabStatus`)        |
| 4   | one reliable verb that folds the above            | `aimux tab run <tab> [--prompt-file f \| --stdin \| text] [--timeout N]` — submits, then blocks until `tabTurnComplete` / `tabQuestion` / exit, returning `{ outcome: completed\|question\|timeout\|error, question?, options?, durationMs }` (exit 0 / 10 / 124 / 3). Collapses spawn→send→uptake→await→snapshot into one event-driven call. | `turnLifecycle` + `questionEvents` |
| 5   | `tab list --verbose` last rendered line           | `aimux tab list --verbose` adds `lastLine` per tab (the last non-blank rendered line), so a fleet poll reads "what each worker is doing" without a per-tab `snapshot`.                                                                                                                                                                        | `listTabsLastLine`                 |

Design notes:

- **`tabTurnComplete` is edge-triggered and uptake-guarded.** It fires once per
  turn (re-armed only after the tab leaves `idle`), and `tab run` ignores it
  until it has first seen the tab go `working` after submit — so a lingering
  pre-submit `idle` can never be misread as "completed".
- **`tabQuestion` options are best-effort.** `prompt` is always the captured
  tail text (source of truth); `options` parses numbered menus / `y/n` per-CLI
  and may be absent even when the screen clearly offers choices.
