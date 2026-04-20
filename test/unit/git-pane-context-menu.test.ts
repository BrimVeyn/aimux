import { expect, test } from 'bun:test'

import { buildGitPaneContextMenu } from '../../src/ui/components/git-pane-context-menu'

test('git pane context menu includes toggle and omits active placement', () => {
  const calls: string[] = []
  const menu = buildGitPaneContextMenu(
    { mode: 'pane', position: 'left' },
    () => calls.push('toggle'),
    (mode, position) => calls.push(`${mode}:${position}`)
  )

  expect(menu.map(([label]) => label)).toEqual([
    'Toggle',
    'Move to top',
    'Move to bottom',
    'Move to right',
  ])

  menu[0]?.[1]()
  menu[1]?.[1]()

  expect(calls).toEqual(['toggle', 'embedded:top'])
})
