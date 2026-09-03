import type { SideEffect } from '../../input/modes/types'
import type { AppAction } from '../../state/actions'

import { onAppEvent } from '../../app-runtime/app-events'
import { bump } from './index'

/**
 * Translates dispatched actions and side effects into counters.
 *
 * One place rather than a `bump()` sprinkled through the reducers: reducers stay
 * pure, and what aimux counts about itself is readable in a single switch
 * instead of being spread across the state layer.
 *
 * Wired through `app-events` rather than called directly, so the counters are
 * one subscriber among others rather than the only consumer the instrumentation
 * knows about.
 */

function countAction(action: AppAction): void {
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

function countEffect(effect: SideEffect): void {
  switch (effect.type) {
    case 'paste-selected-snippet':
    case 'paste-snippet-to-group':
      bump('snippetsFired')
      break
    default:
      break
  }
}

/**
 * Subscribes the counters to the bus. Called once at boot; the disposer exists
 * for tests, which need the counters off to assert on the bus itself.
 */
export function observeCounters(): () => void {
  const disposers = [
    onAppEvent('action', ({ action }) => {
      countAction(action)
    }),
    onAppEvent('effect', ({ effect }) => {
      countEffect(effect)
    }),
  ]
  return () => {
    for (const dispose of disposers) dispose()
  }
}
