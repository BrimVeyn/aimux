import { useCallback, useEffect, useRef, useState } from 'react'

import { Bar } from '@/components/Bar'
import { FocusModeRail } from '@/components/FocusModeRail'
import { GitPanel } from '@/components/git/GitPanel'
import { GitView } from '@/components/git/GitView'
import { ModalHost } from '@/components/ModalHost'
import { Sidebar } from '@/components/Sidebar'
import { SplitLayout } from '@/components/SplitLayout'
import { StatusBar } from '@/components/StatusBar'
import { TabBar } from '@/components/TabBar'
import { TerminalPane } from '@/components/TerminalPane'
import { normalizeKey } from '@/lib/keys'
import { disposeTerminal, liveTerminalIds } from '@/lib/terminal-registry'
import { theme } from '@/lib/theme'
import { useTheme } from '@/lib/use-theme'
import type { AppStateProjection, LayoutNode, ProjectedTab } from '@/lib/types'
import { PROTOCOL_VERSION } from '@/lib/types'
import { type ConnectionStatus, GuiSocket } from '@/lib/ws'

type ConnectionPhase = 'connecting' | 'handshaking' | 'ready' | 'incompatible'

function App() {
  const [projection, setProjection] = useState<AppStateProjection | null>(null)
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [phase, setPhase] = useState<ConnectionPhase>('connecting')
  // Held across renders so the message handler (mounted once) can short-circuit
  // every frame after a version mismatch without React state-update churn.
  const phaseRef = useRef<ConnectionPhase>('connecting')
  const socketRef = useRef<GuiSocket | null>(null)
  // Singleton fan-out for per-tab PTY byte streams. The host emits `bytes`
  // messages; each XtermPane subscribes via `bytes-<tabId>`.
  const bytesEmitterRef = useRef<EventTarget>(new EventTarget())
  // Latest open-modal type + focusMode, read by chrome click handlers without
  // re-creating the callback on every projection frame.
  const modalTypeRef = useRef<string | null>(null)
  const focusModeRef = useRef<string>('navigation')
  modalTypeRef.current = projection?.modal.type ?? null
  focusModeRef.current = projection?.focusMode ?? 'navigation'

  useTheme(projection?.themeId, projection?.themeMode)

  // Keep-alive terminals persist in a module-level registry across tab switches.
  // Dispose an instance only when its tab actually disappears from the projection
  // (closed), so the registry doesn't leak xterm instances / WebGL contexts.
  useEffect(() => {
    if (projection === null) return
    const open = new Set(projection.tabs.map((t) => t.id))
    for (const tabId of liveTerminalIds()) {
      if (!open.has(tabId)) {
        disposeTerminal(tabId, bytesEmitterRef.current)
      }
    }
  }, [projection])

  useEffect(() => {
    document.documentElement.classList.add('dark')
    const socket = new GuiSocket(
      (message) => {
        // After a version mismatch we deliberately refuse to interpret further
        // frames so the user sees the banner (instead of a half-rendered UI
        // running on a stale schema).
        if (phaseRef.current === 'incompatible') return
        if (message.t === 'hello') {
          if (message.version !== PROTOCOL_VERSION) {
            console.error(
              `[gui-protocol] version mismatch: host=${message.version} client=${PROTOCOL_VERSION}`
            )
            phaseRef.current = 'incompatible'
            setPhase('incompatible')
            return
          }
          console.info(
            `[gui-protocol] handshake v${message.version}, caps=[${message.capabilities.join(',')}]`
          )
          phaseRef.current = 'ready'
          setPhase('ready')
          return
        }
        // All other frames require a completed handshake.
        if (phaseRef.current !== 'ready') return
        switch (message.t) {
          case 'state':
            setProjection(message.projection)
            break
          case 'bytes':
            bytesEmitterRef.current.dispatchEvent(
              new CustomEvent(`bytes-${message.tabId}`, { detail: message.data })
            )
            break
          case 'bytesReset':
            bytesEmitterRef.current.dispatchEvent(
              new CustomEvent(`bytesReset-${message.tabId}`, { detail: message.data })
            )
            break
          case 'exit':
          case 'error':
          case 'toast':
            break
          default:
            break
        }
      },
      (next) => {
        setStatus(next)
        // Reset the handshake state whenever the socket lifecycle resets so a
        // reconnect re-validates the version. `incompatible` is a permanent
        // refusal — leave it sticky.
        if (phaseRef.current === 'incompatible') return
        if (next === 'open') {
          phaseRef.current = 'handshaking'
          setPhase('handshaking')
        } else {
          phaseRef.current = 'connecting'
          setPhase('connecting')
        }
      }
    )
    socket.connect()
    socketRef.current = socket
    return () => socket.dispose()
  }, [])

  // Window-level keyboard: every key flows to the host, which runs aimux's
  // keymap/mode pipeline (and forwards unbound keys to the PTY in terminal-input).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Roadmap P1.3 boundary: when the focused element is a real form input
      // (a client-authoritative modal like SnippetEditorModal owns it),
      // never forward to the host. Doing so would (a) double-handle each
      // keystroke and (b) feed the dead per-keystroke modal flow that no
      // longer drives any visible state for this modal.
      // C2 fix: xterm.js owns a hidden helper <textarea> (`xterm-helper-textarea`)
      // for IME/a11y. It holds focus across tab switches and even while detached
      // to the parking lot, so without an exception every host-bound key
      // (git-mode, navigation, modal nav) would be silently swallowed once the
      // user had clicked into any terminal. Treat it as not-a-form-input.
      const target = e.target as HTMLElement | null
      const isXtermHelper =
        target !== null &&
        target.tagName === 'TEXTAREA' &&
        target.classList.contains('xterm-helper-textarea')
      if (
        !isXtermHelper &&
        target !== null &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return
      }
      // ctrl-u/d in git-mode = page up/down in the diff. The TUI mutates a
      // scroll offset in its own renderer; in the GUI we own the scroll via
      // native DOM, so the host action is a no-op for us. Intercept and scroll
      // the diff container directly.
      if (
        e.ctrlKey &&
        (e.key === 'd' || e.key === 'u') &&
        document.querySelector('[data-git-diff-scroll]') !== null
      ) {
        const el = document.querySelector<HTMLElement>('[data-git-diff-scroll]')
        if (el !== null) {
          e.preventDefault()
          const dir = e.key === 'd' ? 1 : -1
          el.scrollBy({ behavior: 'auto', top: dir * el.clientHeight * 0.85 })
          return
        }
      }
      const key = normalizeKey(e)
      if (key === null) {
        return
      }
      e.preventDefault()
      socketRef.current?.send({ t: 'key', ...key })
    }
    const onPaste = (e: ClipboardEvent) => {
      // Same client-authoritative carve-out as onKeyDown: native paste into
      // a form input must stay native (browser inserts text + fires change),
      // not route to the host's PTY-paste pipeline. xterm-helper-textarea is
      // pseudo-input (IME proxy) — treat it as not-a-form-input so paste
      // continues to route into the PTY for terminal panes.
      const target = e.target as HTMLElement | null
      const isXtermHelper =
        target !== null &&
        target.tagName === 'TEXTAREA' &&
        target.classList.contains('xterm-helper-textarea')
      if (
        !isXtermHelper &&
        target !== null &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return
      }
      const text = e.clipboardData?.getData('text') ?? ''
      if (text !== '') {
        e.preventDefault()
        socketRef.current?.send({ t: 'paste', text })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    // Capture phase: xterm.js registers its own paste handler on the
    // xterm-helper-textarea and may stopPropagation, so a bubble-phase listener
    // at window can be silently bypassed. Capture fires before xterm sees it.
    window.addEventListener('paste', onPaste, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('paste', onPaste, true)
    }
  }, [])

  // Chrome (SessionBar/Sidebar/StatusBar) sits above the modal backdrop via
  // z-index, so its buttons stay clickable in any mode. To avoid leaving an
  // open picker/editor visible behind the chrome action, dismiss it first via
  // the same Esc path the backdrop click already uses.
  const dismissModalIfOpen = useCallback(() => {
    if (modalTypeRef.current !== null) {
      socketRef.current?.send({
        ctrl: false,
        meta: false,
        name: 'escape',
        sequence: '',
        shift: false,
        t: 'key',
      })
    }
  }, [])

  const enterInsertMode = useCallback(() => {
    if (focusModeRef.current !== 'terminal-input') {
      socketRef.current?.send({ t: 'enterInsertMode' })
    }
  }, [])

  // Sidebar (the workspace's navigation bar — tab list + "+ New assistant")
  // is the one piece of chrome that means "I'm done typing, take me back".
  // Mouse-down anywhere inside it drops out of terminal-input — separate from
  // SessionBar/StatusBar interactions, which stay neutral.
  const leaveInsertMode = useCallback(() => {
    if (focusModeRef.current === 'terminal-input') {
      socketRef.current?.send({ t: 'leaveInsertMode' })
    }
  }, [])

  const activateTab = useCallback(
    (tabId: string) => {
      dismissModalIfOpen()
      socketRef.current?.send({ t: 'paneActivate', tabId })
    },
    [dismissModalIfOpen]
  )

  const closeTab = useCallback(
    (tabId: string) => {
      dismissModalIfOpen()
      socketRef.current?.send({ t: 'closeTab', tabId })
    },
    [dismissModalIfOpen]
  )

  const newTab = useCallback(() => {
    dismissModalIfOpen()
    socketRef.current?.send({ t: 'openNewTab' })
  }, [dismissModalIfOpen])

  const openUsage = useCallback(() => {
    dismissModalIfOpen()
    socketRef.current?.send({ t: 'openAiUsageModal' })
  }, [dismissModalIfOpen])

  const switchProject = useCallback(
    (projectId: string) => {
      dismissModalIfOpen()
      socketRef.current?.send({ projectId, t: 'switchProject' })
    },
    [dismissModalIfOpen]
  )

  const selectModal = useCallback((index: number) => {
    socketRef.current?.send({ index, t: 'modalSelect' })
  }, [])

  const confirmModal = useCallback((index: number) => {
    socketRef.current?.send({ index, t: 'modalConfirm' })
  }, [])

  // The `+` opens the host's create-project modal, the way the TUI's does —
  // a native folder dialog would be a second way to make a project.
  const newProject = useCallback(() => {
    dismissModalIfOpen()
    socketRef.current?.send({ intent: { kind: 'project.new' }, t: 'intent' })
  }, [dismissModalIfOpen])

  const resizeTab = useCallback((tabId: string, cols: number, rows: number) => {
    socketRef.current?.send({ cols, rows, t: 'resizeTab', tabId })
  }, [])

  const requestBytes = useCallback((tabId: string) => {
    socketRef.current?.send({ t: 'requestBytes', tabId })
  }, [])

  const setSplitRatio = useCallback(
    (tabId: string, ratio: number, axis: 'horizontal' | 'vertical') => {
      socketRef.current?.send({ axis, ratio, t: 'setSplitRatio', tabId })
    },
    []
  )

  const activeTabId = projection?.activeTabId ?? null
  const currentProject = projection?.projects.find((p) => p.id === projection.currentProjectId)

  const toggleWorkspaceMoveDelete = useCallback(() => {
    socketRef.current?.send({ t: 'toggleWorkspaceMoveDelete' })
  }, [])

  const reorderTabs = useCallback((orderedTabIds: string[]) => {
    socketRef.current?.send({ intent: { kind: 'tabs.reorder', orderedTabIds }, t: 'intent' })
  }, [])

  const toggleProjectCollapsed = useCallback((projectId: string) => {
    socketRef.current?.send({
      intent: { kind: 'project.toggleCollapsed', projectId },
      t: 'intent',
    })
  }, [])

  const newWorkspace = useCallback(
    (projectId: string) => {
      dismissModalIfOpen()
      socketRef.current?.send({
        intent: { kind: 'project.newWorkspace', projectId },
        t: 'intent',
      })
    },
    [dismissModalIfOpen]
  )

  const reorderProjects = useCallback((orderedIds: string[]) => {
    socketRef.current?.send({ intent: { kind: 'projects.reorder', orderedIds }, t: 'intent' })
  }, [])

  const activateWorkspace = useCallback(
    (projectId: string, workspaceId: string) => {
      dismissModalIfOpen()
      socketRef.current?.send({
        intent: { kind: 'workspace.activate', projectId, workspaceId },
        t: 'intent',
      })
    },
    [dismissModalIfOpen]
  )

  const openSnippetEditor = useCallback((snippetId?: string) => {
    socketRef.current?.send(
      snippetId !== undefined ? { snippetId, t: 'openSnippetEditor' } : { t: 'openSnippetEditor' }
    )
  }, [])

  // Roadmap P1.3: client-authoritative SnippetEditorModal commits its in-flight
  // buffers in a single intent on submit. Cancel mirrors the TUI's
  // `backToSnippetPicker` — returning to the picker rather than closing the
  // modal stack — via the `modal.snippet.cancel` intent.
  const submitSnippetEditor = useCallback(
    (payload: { name: string; trigger: string; content: string; snippetId?: string }) => {
      socketRef.current?.send({
        intent: { kind: 'modal.snippet.submit', ...payload },
        t: 'intent',
      })
    },
    []
  )
  const cancelSnippetEditor = useCallback(() => {
    socketRef.current?.send({ intent: { kind: 'modal.snippet.cancel' }, t: 'intent' })
  }, [])
  // P2.1: mouse-first git panel. Double-click toggles staged-ness for a file.
  const stageGitFile = useCallback((path: string) => {
    socketRef.current?.send({ intent: { kind: 'git.stageFile', path }, t: 'intent' })
  }, [])
  const unstageGitFile = useCallback((path: string) => {
    socketRef.current?.send({ intent: { kind: 'git.unstageFile', path }, t: 'intent' })
  }, [])
  const toggleGitFolder = useCallback((key: string) => {
    socketRef.current?.send({ intent: { kind: 'git.toggleFolder', key }, t: 'intent' })
  }, [])
  const tabsById: Record<string, ProjectedTab> = {}
  for (const t of projection?.tabs ?? []) {
    tabsById[t.id] = t
  }
  const groupId = activeTabId !== null ? (projection?.tabGroupMap[activeTabId] ?? null) : null
  const activeTree: LayoutNode | null =
    groupId !== null ? (projection?.layoutTrees[groupId] ?? null) : null

  const EMPTY_BAR = { visible: false, widgets: [], width: 0 }
  const bars = projection?.bars ?? { left: EMPTY_BAR, right: EMPTY_BAR }
  const gitPane = projection?.gitPane
  const inGitMode = projection?.focusMode === 'git' || projection?.modal.type === 'git-commit'

  const sidebarElement =
    projection !== null ? (
      <Sidebar
        currentProjectId={projection.currentProjectId}
        onInteract={leaveInsertMode}
        onNewProject={newProject}
        onNewWorkspace={newWorkspace}
        onReorderProjects={reorderProjects}
        onSelectWorkspace={activateWorkspace}
        onSwitchProject={switchProject}
        onToggleCollapsed={toggleProjectCollapsed}
        projects={projection.projects}
        tabs={projection.tabs}
        workspaceActivity={projection.workspaceActivity}
        workspaceDivergence={projection.workspaceDivergence}
      />
    ) : null

  const gitPanelElement =
    projection !== null && gitPane !== undefined ? (
      <div
        className="h-full overflow-hidden"
        style={{ backgroundColor: theme.backgroundPanel, padding: 8 }}
      >
        <GitPanel
          gitMode={projection.gitMode}
          gitPane={gitPane}
          gitPanel={projection.gitPanel}
          onStageFile={stageGitFile}
          onToggleFolder={toggleGitFolder}
          onUnstageFile={unstageGitFile}
          projectPath={currentProject?.projectPath}
        />
      </div>
    ) : null


  const sendEscape = useCallback(() => {
    // Single Esc transport for click-driven affordances (git-mode back button,
    // modal backdrop click). The host's per-mode keymap decides what Esc does,
    // so the GUI mirrors the keyboard path instead of dispatching mode-specific
    // actions itself.
    socketRef.current?.send({
      ctrl: false,
      meta: false,
      name: 'escape',
      sequence: '',
      shift: false,
      t: 'key',
    })
  }, [])
  const exitGitMode = sendEscape

  const gitViewElement =
    projection !== null && gitPane !== undefined ? (
      <GitView
        gitMode={projection.gitMode}
        gitPane={gitPane}
        gitPanel={projection.gitPanel}
        onExit={exitGitMode}
        onStageFile={stageGitFile}
        onToggleFolder={toggleGitFolder}
        onUnstageFile={unstageGitFile}
        projectPath={currentProject?.projectPath}
        themeId={projection.themeId}
      />
    ) : null

  if (phase === 'incompatible') {
    return (
      <div
        className="flex h-screen w-screen flex-col items-center justify-center gap-3 p-8 text-center font-mono text-sm"
        style={{ backgroundColor: theme.background, color: theme.text }}
      >
        <div className="text-lg font-semibold" style={{ color: theme.error }}>
          GUI protocol version mismatch
        </div>
        <div style={{ color: theme.textMuted }}>
          This desktop expects protocol v{PROTOCOL_VERSION}, but the host speaks a different
          version. Update both halves of aimux to the same release.
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen w-screen flex-col" style={{ backgroundColor: theme.background }}>
      <div className="flex min-h-0 flex-1">
        <Bar
          bar={bars.left}
          side="left"
          widgets={{ git: gitPanelElement, projects: sidebarElement }}
        />
        <main className="flex min-w-0 flex-1 flex-col">
          {/* The strip sits inside the pane column, not above the bars — same
              place the TUI puts it. In git mode it stays as something to read,
              minus the `+` that would quietly pull you out of the screen. */}
          <TabBar
            activeTabId={activeTabId}
            focused={
              projection?.focusMode === 'terminal-input' ||
              projection?.focusMode === 'navigation'
            }
            layoutTrees={projection?.layoutTrees ?? {}}
            onActivate={activateTab}
            onClose={closeTab}
            onNew={newTab}
            onReorder={reorderTabs}
            panesReplaced={inGitMode}
            project={currentProject}
            tabGroupMap={projection?.tabGroupMap ?? {}}
            tabs={projection?.tabs ?? []}
          />
          {inGitMode ? (
            <div className="min-h-0 flex-1">{gitViewElement}</div>
          ) : (
            <>
              <div className="min-h-0 flex-1">
                {activeTree !== null && activeTree.type === 'split' ? (
                  <SplitLayout
                    activeTabId={activeTabId}
                    bytesEmitter={bytesEmitterRef.current}
                    focusMode={projection?.focusMode ?? 'navigation'}
                    node={activeTree}
                    onActivate={activateTab}
                    onEnterInsert={enterInsertMode}
                    onRequestBytes={requestBytes}
                    onResizeTab={resizeTab}
                    onSetSplitRatio={setSplitRatio}
                    tabsById={tabsById}
                    themeId={projection?.themeId ?? ''}
                  />
                ) : activeTabId !== null ? (
                  <TerminalPane
                    bytesEmitter={bytesEmitterRef.current}
                    focusMode={projection?.focusMode ?? 'navigation'}
                    isActive
                    onActivate={activateTab}
                    onEnterInsert={enterInsertMode}
                    onRequestBytes={requestBytes}
                    onResizeTab={resizeTab}
                    tab={tabsById[activeTabId]}
                    tabId={activeTabId}
                    themeId={projection?.themeId ?? ''}
                  />
                ) : null}
              </div>
              <FocusModeRail focusMode={projection?.focusMode ?? 'navigation'} />
            </>
          )}
        </main>
        <Bar
          bar={bars.right}
          side="right"
          widgets={{ git: gitPanelElement, projects: sidebarElement }}
        />
      </div>
      {projection ? (
        <StatusBar projection={projection} connecting={status !== 'open'} onOpenUsage={openUsage} />
      ) : (
        <div
          className="flex shrink-0 flex-row justify-end px-2 py-0.5 font-mono text-xs"
          style={{ backgroundColor: theme.backgroundPanel, color: theme.textMuted }}
        >
          {status}
        </div>
      )}
      {projection ? (
        <ModalHost
          modal={projection.modal}
          customCommands={projection.customCommands}
          workspaces={currentProject?.workspaces ?? []}
          workspaceDivergence={projection.workspaceDivergence}
          projects={projection.projects}
          currentProjectId={projection.currentProjectId}
          snippets={projection.snippets}
          committedThemeId={projection.committedThemeId}
          helpEntries={projection.helpEntries}
          aiUsageSnapshots={projection.aiUsage.snapshots}
          directoryResults={projection.modal.directoryResults ?? []}
          gitFiles={projection.gitPanel.files}
          onSelect={selectModal}
          onConfirm={confirmModal}
          onToggleDeleteSource={toggleWorkspaceMoveDelete}
          onOpenSnippetEditor={openSnippetEditor}
          onSnippetSubmit={submitSnippetEditor}
          onSnippetCancel={cancelSnippetEditor}
          onBackdropClick={sendEscape}
        />
      ) : null}
    </div>
  )
}

export default App
