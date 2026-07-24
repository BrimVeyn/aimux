---
name: aimux-orchestrator
description: Orchestrate implementation plans with parallel Claude, Codex, OpenCode, Grok, or Kimi workers through the aimux worker CLI. Use when an agent must decompose a plan, launch isolated workers, supervise questions and failures, review each worker's diff and checks, integrate accepted work, and clean up safely.
---

# aimux Orchestrator

Own the plan and quality gate. Let aimux own worker transport and lifecycle.

## Preflight

Run once:

```bash
aimux worker doctor
aimux worker --help
```

Stop if the doctor reports missing worker capabilities, the wrong workspace, or
an unavailable assistant. Restart/update aimux as instructed; do not fall back
to screen scraping or the legacy shell wrappers.

## Orchestration loop

1. Parse the plan into independently reviewable units and dependencies.
2. Record units in a ledger. Copy `assets/ledger.template.md` for multi-unit work.
3. Select only units whose dependencies are accepted.
4. Launch no more workers than you can review:

```bash
aimux worker run \
  --name feat-auth \
  --assistant claude \
  --prompt-file /tmp/feat-auth.md \
  --detach
```

5. Inspect the fleet with `aimux worker list`.
6. Await a detached worker with `aimux worker await feat-auth`.
7. If a worker asks a question, answer only when the plan already determines the
   answer:

```bash
aimux worker prompt feat-auth --prompt-file /tmp/answer.md
```

Escalate design choices, irreversible operations, deployments, pushes,
migrations, spending, and external communication to the human.

8. Review the worktree path returned in the worker JSON. Read the diff and run
   the repository's required tests, typecheck, lint, and build. Worker claims
   are not evidence.
9. Accept, request a precise correction with `worker prompt`, or escalate.
10. After integration, close and clean up:

```bash
aimux worker stop feat-auth --cleanup-worktree
```

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

## Quality and safety

Read `references/review.md` before accepting the first unit.

- `completed` means the turn ended, not that the change is correct.
- Never accept a failing or unrun verification gate.
- Cap correction attempts at three; then escalate with evidence.
- Never use `--force` cleanup unless the human authorized discarding dirty work.
- Keep the ledger truthful after every dispatch, outcome, review, and integration.

The CLI is the command reference. Use `aimux worker <verb> --help` instead of
copying flags or JSON shapes into this skill.
