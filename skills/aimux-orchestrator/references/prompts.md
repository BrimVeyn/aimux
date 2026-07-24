# Worker prompts

## Task

```markdown
# Task: <id> — <title>

## Goal

<observable outcome>

## Scope

- In: <files or subsystem>
- Out: <explicit exclusions>

## Requirements

1. <behavior>
2. <edge case>

## Acceptance

- <machine-checkable criterion>

## Verification

Run the repository's tests, typecheck, lint, and build commands that apply.
Report changed files, commands run, results, and remaining risks.
```

Tell the worker to read repository instructions before editing. Do not ask it to
merge, push, deploy, or clean up its worktree.

## Correction

```markdown
# Correction for <id>

The review found:

- <specific failing behavior with file/test evidence>

Required change:

- <bounded correction>

Do not broaden scope. Re-run:

- <exact verification commands>
```

## Answer

Answer the exact question and restate any relevant boundary. If the question
introduces a product decision or risky action not settled by the plan, escalate
instead of improvising.
