import { describe, expect, test } from 'bun:test'

import { CLI_GROUPS } from '../../src/cli/groups'
import { COMMANDS } from '../../src/cli/registry'

/**
 * `src/index.tsx` decides "CLI or TUI?" from `CLI_GROUPS` before it imports the
 * registry, so the two lists are maintained separately. A group missing from
 * `CLI_GROUPS` does not error — the command falls through and boots the
 * interactive UI, which from a script looks like a hang. Hence this test.
 */
describe('CLI group routing', () => {
  test('every registered command group routes to the CLI', () => {
    const registered = [...new Set(COMMANDS.map((command) => command.group))].sort()
    expect(registered.filter((group) => !CLI_GROUPS.has(group))).toEqual([])
  })

  test('no group routes to the CLI without commands behind it', () => {
    const registered = new Set(COMMANDS.map((command) => command.group))
    expect([...CLI_GROUPS].filter((group) => !registered.has(group))).toEqual([])
  })
})
