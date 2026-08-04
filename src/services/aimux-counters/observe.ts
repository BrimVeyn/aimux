import type { SideEffect } from '../../input/modes/types'
import type { AppAction } from '../../state/actions'

import { bump } from './index'

/**
 * Translates dispatched actions and side effects into counters.
 *
 * One place rather than a `bump()` sprinkled through the reducers: reducers stay
 * pure, and what aimux counts about itself is readable in a single switch
 * instead of being spread across the state layer.
 */

export function countAction(action: AppAction): void {
  switch (action.type) {
    case 'add-tab':
      bump('tabsOpened')
      break
    case 'add-workspace-record':
      bump('workspacesCreated')
      break
    case 'split-pane':
      bump(action.direction === 'vertical' ? 'splitsVertical' : 'splitsHorizontal')
      break
    default:
      break
  }
}

export function countEffect(effect: SideEffect): void {
  switch (effect.type) {
    case 'paste-selected-snippet':
    case 'paste-snippet-to-group':
      bump('snippetsFired')
      break
    default:
      break
  }
}
