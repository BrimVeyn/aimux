import { expect, test } from 'bun:test'

import { fitActionLabels } from '../../src/ui/components/setup/setup-widget'

const ACTIONS = [
  { icon: '↻', text: 'Re-run' },
  { icon: '✎', text: 'Edit' },
  { icon: '✦', text: 'Agent' },
  { icon: '↗', text: '' },
]

test('the action row degrades from icon + word, to word, to icon as the bar narrows', () => {
  // "↻ Re-run" "✎ Edit" "✦ Agent" "↗": 10 + 8 + 9 + 3 cells, plus 3 gaps.
  expect(fitActionLabels(ACTIONS, 33)).toEqual(['↻ Re-run', '✎ Edit', '✦ Agent', '↗'])
  expect(fitActionLabels(ACTIONS, 32)).toEqual(['Re-run', 'Edit', 'Agent', '↗'])
  expect(fitActionLabels(ACTIONS, 26)).toEqual(['↻', '✎', '✦', '↗'])
})
