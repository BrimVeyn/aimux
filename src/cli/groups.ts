/**
 * Command groups that route to the CLI control plane instead of booting the
 * TUI. `src/index.tsx` branches on this before it imports anything heavy, so
 * this module must stay a bare literal — no imports, nothing to resolve.
 *
 * It duplicates what `COMMANDS` already knows, and that duplication is the
 * point: importing the registry here would pay for every `aimux __complete`,
 * which runs on each TAB press. `test/unit/cli-groups.test.ts` fails the build
 * if the two ever disagree — a missing group is silent and awful, since the
 * command falls through and launches the interactive UI instead.
 */
export const CLI_GROUPS: ReadonlySet<string> = new Set([
  'tab',
  'project',
  'workspace',
  'worker',
  'plugin',
  'skill',
])
