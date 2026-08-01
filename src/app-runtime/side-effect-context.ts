import type { CliRenderer } from '@opentui/core'

import type { SessionBackend } from '../session-backend/types'
import type { AppAction } from '../state/actions'
import type { AppState, TabSession } from '../state/types'
import type { ThemeId } from '../ui/themes'

/**
 * Everything a side effect is allowed to reach: the store, the pty backend, the
 * renderer, and the few timers the tab lifecycle owns.
 *
 * Lives apart from `side-effects.ts` so the per-domain effect modules can take
 * it without importing the dispatcher that calls them.
 */
export interface SideEffectContext {
  /**
   * The render snapshot. Fine for anything read and used in the same turn;
   * anything that awaits — git, a spawn, a model call — must read `getState()`
   * instead, because by then this is stale.
   */
  state: AppState
  dispatch: (action: AppAction) => void
  backend: SessionBackend
  renderer: CliRenderer
  themeId: ThemeId
  setThemeId: (id: ThemeId) => void
  activeTab: TabSession | undefined
  clearIdleTimer: (tabId: string) => void
  clearStartupGrace: (tabId: string) => void
  startStartupGrace: (tabId: string, timeoutMs: number) => void
  getState: () => AppState
  getCurrentProjectProjectPath: () => string | undefined
}
