# Worker review gate

Review inside the returned worktree path.

1. Read repository instructions and the dispatched acceptance criteria.
2. Inspect status and the complete diff against the unit's base.
3. Confirm every changed hunk belongs to the requested scope.
4. Check correctness, edge cases, error paths, tests, debug leftovers, secrets,
   stubs, and repository conventions.
5. Run the required test, typecheck, lint, format-check, and build commands
   yourself.
6. Record evidence in the ledger.

Accept only when the behavior and verification pass. If a check cannot run,
record why and escalate when it prevents a trustworthy decision.

Request changes with concrete evidence: location, observed behavior, expected
behavior, and the exact gate to rerun. Do not send a vague "fix the tests" prompt.
