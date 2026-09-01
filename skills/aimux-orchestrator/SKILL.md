---
name: aimux-orchestrator
description: Orchestrate implementation plans with parallel Claude, Codex, OpenCode, Grok, or Kimi workers through the aimux worker CLI. Use when an agent must decompose a plan, launch isolated workers, supervise questions and failures, review each worker's diff and checks, integrate accepted work, and clean up safely.
---

# aimux Orchestrator

Own the plan and quality gate. Let aimux own worker transport and lifecycle.

## Preflight

Run once:

```bash
aimux worker doctor --workspace <target>
aimux worker --help
```

Stop if the doctor reports missing worker capabilities, the wrong workspace, or
an unavailable assistant. Restart/update aimux as instructed; do not fall back
to screen scraping or the legacy shell wrappers.

**Pin the workspace and verify the repo before dispatching anything.** Without
`--workspace` (or `AIMUX_WORKSPACE`) aimux targets whichever workspace the UI
opened last, and that can change under you mid-run — including to a different
project. Check `checks.workspace.repoRoot` in the doctor output against the
repository you mean, then pass `--workspace <id|name>` on **every** call (all
examples below do). Every worker response echoes `workspace.repoRoot`; read it on
the first dispatch instead of assuming.

## Orchestration loop

1. Parse the plan into independently reviewable units and dependencies.
2. Record units in a ledger. Copy `assets/ledger.template.md` for multi-unit work.
3. Select only units whose dependencies are accepted.
4. Launch no more workers than you can review:

```bash
aimux worker run \
  --workspace <target> \
  --name feat-auth \
  --assistant claude \
  --prompt-file /tmp/feat-auth.md \
  --detach
```

5. Inspect the fleet with `aimux worker list --workspace <target>`.
6. Await a detached worker with `aimux worker await feat-auth --workspace <target>`.
7. If a worker asks a question, answer only when the plan already determines the
   answer:

```bash
aimux worker prompt feat-auth --workspace <target> --replace --prompt-file /tmp/answer.md
```

Escalate design choices, irreversible operations, deployments, pushes,
migrations, spending, and external communication to the human.

8. Review the worktree path returned in the worker JSON. Read the diff and run
   the repository's required tests, typecheck, lint, and build. Worker claims
   are not evidence.
9. Accept, request a precise correction with `worker prompt`, or escalate.
10. After integration, close and clean up:

```bash
aimux worker stop feat-auth --workspace <target> --cleanup-worktree
```

## Dispatch failure modes

Read these before the first dispatch; each one otherwise reads as a lost fleet.

- **`status: "pending-submit"` (exit 11)** — the prompt is sitting unsubmitted in
  the worker's composer. The worker is alive and healthy. Recover with
  `aimux worker submit <name> --workspace <target>`; never re-dispatch, which
  would double the fleet onto the same branches. Widen the confirmation window
  with `--uptake-timeout <ms>` for slow-booting assistants.
- **An empty `worker list`** — read the `workspace` field in the response. An
  empty fleet in the wrong workspace is not a dead fleet. Add
  `--all-workspaces` to answer "are they really gone?" in one call;
  `git worktree list` in the target repo is the on-disk cross-check.
- **Composer contamination** — a human typing in a worker's tab leaves text that
  `worker prompt` would append to, merging both into one incoherent instruction.
  Use `--replace` (clears with `<C-u>`) for every correction, and
  `aimux tab snapshot <tabId>` when a worker's behaviour doesn't match the
  prompt you believe you sent.
- **Fresh worktrees are not provisioned** — a new worktree has no installed
  dependencies and no generated files. Every dispatch prompt must tell the worker
  to bootstrap before running any gate (see `references/prompts.md`), or it will
  report environment failures as its own.

## Isolation

`worker run` creates a fresh worktree by default. Keep that default when writes
may overlap or scope is uncertain.

- Use `--worktree <id>` only for workers intentionally sharing one review unit.
- Use `--no-worktree` only for sequential work or provably disjoint writes in
  the active tree.
- Review co-located workers together because their diff is shared.

## Dispatch rules

- Give each worker one bounded unit with goal, scope, exclusions, acceptance
  criteria, repository conventions, and required verification.
- Read `references/prompts.md` when drafting task or correction prompts.
- Use provider defaults unless the plan or user requires a model. Set
  `--model`/`--effort` only when `worker doctor` says the assistant supports the
  control.
- Prefer `--prompt-file` for multiline prompts; it avoids shell quoting hazards.
- Use `--detach` for parallel launch. Without it, `worker run` waits and returns
  a completed/question/timeout/error outcome.
- Pass `--workspace` on every call, and confirm the `repoRoot` the first response
  reports is the repository you intend to change.

## Quality and safety

Read `references/review.md` before accepting the first unit.

- `completed` means the turn ended, not that the change is correct.
- Never accept a failing or unrun verification gate.
- Cap correction attempts at three; then escalate with evidence.
- Never use `--force` cleanup unless the human authorized discarding dirty work.
- Keep the ledger truthful after every dispatch, outcome, review, and integration.

The CLI is the command reference. Use `aimux worker <verb> --help` instead of
copying flags or JSON shapes into this skill.
