import type { CliRenderer } from '@opentui/core'

import type { SideEffectContext } from '../app-runtime/side-effect-context'
import type { SessionBackend } from '../session-backend/types'
import type { AppAction } from '../state/actions'
import type { AppState } from '../state/types'
import type { ThemeId } from '../ui/themes'

import { getActiveWorkspacePath } from '../state/workspace-view'

// The GUI has no shared TTY. executeSideEffect only touches the renderer in
// `quit`, `runUpdateFromTui`, and `openEditorInline`; a no-op stub satisfies
// all three (the host closes via process exit; GUI editors spawn detached).
export function createStubRenderer(): CliRenderer {
  const noop = (): void => {}
  return {
    currentRenderBuffer: { clear: noop },
    destroy: noop,
    requestRender: noop,
    resume: noop,
    suspend: noop,
  } as unknown as CliRenderer
}

export interface TabTimeouts {
  clearIdleTimer: (tabId: string) => void
  clearStartupGrace: (tabId: string) => void
  startStartupGrace: (tabId: string, timeoutMs: number) => void
  clearAllTimers: () => void
}

// Plain (non-React) port of useTabRuntimeTimeouts.
export function createTabTimeouts(): TabTimeouts {
  const startupGrace = new Map<string, ReturnType<typeof setTimeout>>()

  const clearStartupGrace = (tabId: string): void => {
    const timer = startupGrace.get(tabId)
    if (timer) {
      clearTimeout(timer)
      startupGrace.delete(tabId)
    }
  }

  return {
    clearAllTimers: () => {
      for (const timer of startupGrace.values()) {
        clearTimeout(timer)
      }
      startupGrace.clear()
    },
    clearIdleTimer: () => {
      // Idle is driven entirely by the backend status loop (tabActivity).
    },
    clearStartupGrace,
    startStartupGrace: (tabId, timeoutMs) => {
      clearStartupGrace(tabId)
      startupGrace.set(
        tabId,
        setTimeout(() => startupGrace.delete(tabId), timeoutMs)
      )
    },
  }
}

interface MakeContextOptions {
  backend: SessionBackend
  getState: () => AppState
  dispatch: (action: AppAction) => void
  renderer: CliRenderer
  timeouts: TabTimeouts
  getThemeId: () => ThemeId
  setThemeId: (id: ThemeId) => void
}

// Build a fresh SideEffectContext snapshotting the current state, mirroring how
// app.tsx rebuilds it each render.
export function makeSideEffectContext(opts: MakeContextOptions): SideEffectContext {
  const state = opts.getState()
  return {
    activeTab: state.tabs.find((tab) => tab.id === state.activeTabId),
    backend: opts.backend,
    clearIdleTimer: opts.timeouts.clearIdleTimer,
    clearStartupGrace: opts.timeouts.clearStartupGrace,
    dispatch: opts.dispatch,
    getCurrentProjectProjectPath: () => {
      const id = state.currentProjectId
      if (!(id != null && id !== '')) {
        return
      }
      return getActiveWorkspacePath(state.projects.find((session) => session.id === id))
    },
    getState: opts.getState,
    renderer: opts.renderer,
    setThemeId: opts.setThemeId,
    startStartupGrace: opts.timeouts.startStartupGrace,
    state,
    themeId: opts.getThemeId(),
  }
}
