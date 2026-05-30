import { open } from '@tauri-apps/plugin-dialog'
import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { GitPanel } from '@/components/git/GitPanel'
import { GitView } from '@/components/git/GitView'
import { ModalHost } from '@/components/ModalHost'
import { SessionBar } from '@/components/SessionBar'
import { Sidebar } from '@/components/Sidebar'
import { SplitLayout } from '@/components/SplitLayout'
import { StatusBar } from '@/components/StatusBar'
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
    window.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('paste', onPaste)
    }
  }, [])

  const activateTab = useCallback((tabId: string) => {
    socketRef.current?.send({ t: 'paneActivate', tabId })
  }, [])

  const closeTab = useCallback((tabId: string) => {
    socketRef.current?.send({ t: 'closeTab', tabId })
  }, [])

  const newTab = useCallback(() => {
    socketRef.current?.send({ t: 'openNewTab' })
  }, [])

  const openUsage = useCallback(() => {
    socketRef.current?.send({ t: 'openAiUsageModal' })
  }, [])

  const switchSession = useCallback((sessionId: string) => {
    socketRef.current?.send({ sessionId, t: 'switchSession' })
  }, [])

  const deleteSession = useCallback((sessionId: string) => {
    socketRef.current?.send({ sessionId, t: 'deleteSession' })
  }, [])

  const selectModal = useCallback((index: number) => {
    socketRef.current?.send({ index, t: 'modalSelect' })
  }, [])

  const confirmModal = useCallback((index: number) => {
    socketRef.current?.send({ index, t: 'modalConfirm' })
  }, [])

  const newSession = useCallback(() => {
    void (async () => {
      let path: string | null = null
      try {
        const picked = await open({ directory: true, multiple: false })
        path = typeof picked === 'string' ? picked : null
      } catch {
        path = window.prompt('Folder path for new session:')
      }
      if (path !== null && path !== '') {
        socketRef.current?.send({ path, t: 'createSession' })
      }
    })()
  }, [])

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
  const currentSession = projection?.sessions.find((s) => s.id === projection.currentSessionId)
  const activeWorktree = currentSession?.worktrees?.find(
    (w) => w.id === currentSession.activeWorktreeId
  )
  const sidebarBranch = activeWorktree?.branch ?? null

  const toggleWorktreeMoveDelete = useCallback(() => {
    socketRef.current?.send({ t: 'toggleWorktreeMoveDelete' })
  }, [])

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
  const tabsById: Record<string, ProjectedTab> = {}
  for (const t of projection?.tabs ?? []) {
    tabsById[t.id] = t
  }
  const groupId = activeTabId !== null ? (projection?.tabGroupMap[activeTabId] ?? null) : null
  const activeTree: LayoutNode | null =
    groupId !== null ? (projection?.layoutTrees[groupId] ?? null) : null

  const gitPane = projection?.gitPane
  const inGitMode = projection?.focusMode === 'git' || projection?.modal.type === 'git-commit'
  // Stage 2a: pane+top/bottom isn't a real TUI combo (top/bottom are embedded-only).
  // Fall back to left-pane behavior so the panel is still visible if the host ever
  // emits this combo; Task 3 may revisit.
  const showPanelLeftOrRight =
    !inGitMode &&
    gitPane?.visible === true &&
    gitPane.mode === 'pane' &&
    (gitPane.position === 'left' ||
      gitPane.position === 'right' ||
      gitPane.position === 'top' ||
      gitPane.position === 'bottom')
  const showPanelEmbedded =
    !inGitMode &&
    gitPane?.visible === true &&
    gitPane.mode === 'embedded' &&
    (gitPane.position === 'top' || gitPane.position === 'bottom')
  const panelOnRight = gitPane?.mode === 'pane' && gitPane.position === 'right'

  const gitPanelElement =
    projection !== null && gitPane !== undefined ? (
      <div
        className="h-full overflow-hidden border-r"
        style={{
          backgroundColor: theme.backgroundPanel,
          borderColor: theme.border,
          padding: 8,
        }}
      >
        <GitPanel
          gitMode={projection.gitMode}
          gitPane={gitPane}
          gitPanel={projection.gitPanel}
          onStageFile={stageGitFile}
          onUnstageFile={unstageGitFile}
          projectPath={currentSession?.projectPath}
        />
      </div>
    ) : null

  const paneWrapperStyle: React.CSSProperties =
    gitPane !== undefined
      ? { flexBasis: `${gitPane.paneRatio * 100}%`, flexShrink: 0, minWidth: 0 }
      : {}

  const exitGitMode = useCallback(() => {
    // The host runs aimux's git-mode keymap; sending Escape exits the mode.
    socketRef.current?.send({
      ctrl: false,
      meta: false,
      name: 'escape',
      sequence: '',
      shift: false,
      t: 'key',
    })
  }, [])

  const gitViewElement =
    projection !== null && gitPane !== undefined ? (
      <GitView
        gitMode={projection.gitMode}
        gitPane={gitPane}
        gitPanel={projection.gitPanel}
        onExit={exitGitMode}
        onStageFile={stageGitFile}
        onUnstageFile={unstageGitFile}
        projectPath={currentSession?.projectPath}
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
      <SessionBar
        sessions={projection?.sessions ?? []}
        statuses={projection?.sessionStatuses ?? {}}
        currentSessionId={projection?.currentSessionId ?? null}
        onSwitch={switchSession}
        onNew={newSession}
        onDelete={deleteSession}
      />
      <div className="flex min-h-0 flex-1">
        {inGitMode ? (
          gitViewElement
        ) : (
          <>
            <Sidebar
              sessionName={currentSession?.name ?? null}
              branch={sidebarBranch}
              tabs={projection?.tabs ?? []}
              activeTabId={activeTabId}
              onSelectTab={activateTab}
              onCloseTab={closeTab}
              onNewTab={newTab}
              embeddedRatio={showPanelEmbedded ? gitPane?.embeddedRatio : undefined}
              gitPanelPosition={
                showPanelEmbedded ? (gitPane?.position as 'top' | 'bottom') : undefined
              }
              gitPanelSlot={showPanelEmbedded ? gitPanelElement : undefined}
            />
            {showPanelLeftOrRight && !panelOnRight ? (
              <div style={paneWrapperStyle}>{gitPanelElement}</div>
            ) : null}
            <main className="min-w-0 flex-1 p-1">
              {activeTree !== null && activeTree.type === 'split' ? (
                <SplitLayout
                  activeTabId={activeTabId}
                  bytesEmitter={bytesEmitterRef.current}
                  node={activeTree}
                  onActivate={activateTab}
                  onRequestBytes={requestBytes}
                  onResizeTab={resizeTab}
                  onSetSplitRatio={setSplitRatio}
                  tabsById={tabsById}
                  themeId={projection?.themeId ?? ''}
                />
              ) : activeTabId !== null ? (
                <TerminalPane
                  bytesEmitter={bytesEmitterRef.current}
                  isActive
                  onActivate={activateTab}
                  onRequestBytes={requestBytes}
                  onResizeTab={resizeTab}
                  tab={tabsById[activeTabId]}
                  tabId={activeTabId}
                  themeId={projection?.themeId ?? ''}
                />
              ) : null}
            </main>
            {showPanelLeftOrRight && panelOnRight ? (
              <div style={paneWrapperStyle}>{gitPanelElement}</div>
            ) : null}
          </>
        )}
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
          worktrees={currentSession?.worktrees ?? []}
          worktreeDivergence={projection.worktreeDivergence}
          sessions={projection.sessions}
          currentSessionId={projection.currentSessionId}
          snippets={projection.snippets}
          committedThemeId={projection.committedThemeId}
          helpEntries={projection.helpEntries}
          aiUsageSnapshots={projection.aiUsage.snapshots}
          directoryResults={projection.modal.directoryResults ?? []}
          gitFiles={projection.gitPanel.files}
          onSelect={selectModal}
          onConfirm={confirmModal}
          onToggleDeleteSource={toggleWorktreeMoveDelete}
          onOpenSnippetEditor={openSnippetEditor}
          onSnippetSubmit={submitSnippetEditor}
          onSnippetCancel={cancelSnippetEditor}
        />
      ) : null}
    </div>
  )
}

export default App
