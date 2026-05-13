import {
  DEFAULT_EDITOR_ARGS,
  getExternalEditorConfig,
  isAutoCommitEnabled,
  KNOWN_GUI_EDITORS,
} from '@brimveyn/aimux-config'
import { type CliRenderer } from '@opentui/core'
import { $ } from 'bun'

import type { SideEffect } from '../input/modes/types'
import type { SessionBackend } from '../session-backend/types'

import { loadConfig, saveConfig } from '../config'
import { logInputDebug } from '../debug/input-log'
import { enqueueGitOp } from '../git/command-queue'
import { createPrefixedId } from '../platform/id'
import {
  getAllAssistantOptions,
  getAssistantOption,
  isCommandAvailable,
  parseCommand,
} from '../pty/command-registry'
import { createTerminalBounds } from '../state/layout-resize'
import {
  allLeafIds,
  computePaneRects,
  createLeaf,
  getGroupIdForTab,
  getTreeForTab,
  PANE_BORDER,
  type SplitDirection,
  splitNode,
} from '../state/layout-tree'
import { filterAssistants, filterSessions, filterSnippets } from '../state/selectors'
import { createDefaultTerminalModes } from '../state/terminal-modes'
import {
  type AppAction,
  type AppState,
  type AssistantId,
  DEFAULT_SCROLL_INTENT,
  type TabSession,
} from '../state/types'
import { saveCurrentWorkspace } from '../state/workspace-save'
import { filterThemeIds } from '../ui/filter-themes'
import { scrollGitDiff } from '../ui/git-view-controls'
import { applyTheme, getCurrentMode, getTransparent, setMode, setTransparent } from '../ui/theme'
import { type ThemeId } from '../ui/themes'
import { triggerAutoCommitNow } from './auto-commit-ref'
import {
  handleCreateSessionEffect,
  handleDeleteSessionEffect,
  handleRenameSessionEffect,
  handleSwitchSessionEffect,
  restartTabSession,
} from './session-actions'
import {
  handleDeleteSnippetEffect,
  handleSaveSnippetEditorEffect,
  pasteSnippetToTab,
} from './snippet-actions'

const STARTUP_GRACE_MS = 5_000

export interface SideEffectContext {
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
  getCurrentSessionProjectPath: () => string | undefined
}

function getSelectedAssistantOption(state: AppState) {
  const all = getAllAssistantOptions(state.customCommands)
  const filter = state.modal.type === 'new-tab' ? state.modal.editBuffer : null
  const list = filterAssistants(all, filter)
  return list[state.modal.selectedIndex] ?? list[0] ?? getAssistantOption(0)
}

function handleSessionSelection(ctx: SideEffectContext): void {
  const { backend, dispatch, state } = ctx
  const selectedSession = getSelectedSession(state)
  logInputDebug('app.sessionPicker.confirm', {
    creatingNew: !selectedSession,
    selectedIndex: state.modal.selectedIndex,
    selectedSessionId: selectedSession?.id ?? null,
  })

  if (selectedSession) {
    handleSwitchSessionEffect(state, backend, dispatch, selectedSession)
    return
  }

  dispatch({ returnToSessionPicker: true, type: 'open-create-session-modal' })
}

function handleSelectedSessionDelete(ctx: SideEffectContext): void {
  const { backend, dispatch, state } = ctx
  const selectedSession = getSelectedSession(state)
  logInputDebug('app.sessionPicker.deleteSelected', {
    selectedIndex: state.modal.selectedIndex,
    selectedSessionId: selectedSession?.id ?? null,
  })

  if (selectedSession) {
    handleDeleteSessionEffect(state, backend, dispatch, selectedSession.id, {
      openSessionPicker: true,
    })
  }
}

function openSelectedSessionRename(ctx: SideEffectContext): void {
  const { dispatch, state } = ctx
  const selectedSession = getSelectedSession(state)
  if (!selectedSession) {
    return
  }

  logInputDebug('app.sessionPicker.openRenameModal', {
    selectedIndex: state.modal.selectedIndex,
    selectedSessionId: selectedSession.id,
  })
  dispatch({
    initialName: selectedSession.name,
    sessionTargetId: selectedSession.id,
    type: 'open-session-name-modal',
  })
}

function pasteSnippetToActiveGroup(ctx: SideEffectContext): void {
  const { activeTab, backend, state } = ctx
  const snippet = getSelectedSnippet(state)
  if (!snippet || !state.activeTabId) {
    return
  }

  const groupId = getGroupIdForTab(state.tabGroupMap, state.activeTabId)
  const groupTree = groupId ? state.layoutTrees[groupId] : null
  if (!groupTree) {
    pasteSnippetToTab(backend, state.activeTabId, activeTab, snippet, ctx.dispatch)
    return
  }

  for (const tabId of allLeafIds(groupTree)) {
    const tab = state.tabs.find((entry) => entry.id === tabId)
    if (tab) {
      pasteSnippetToTab(backend, tabId, tab, snippet, ctx.dispatch)
    }
  }
}

function saveCustomCommandSelection(ctx: SideEffectContext): void {
  const { dispatch, state } = ctx
  if (state.modal.type !== 'new-tab' || state.modal.editingCommand === null) {
    return
  }
  const assistantId = state.modal.editingCommand
  if (state.modal.editBuffer === null) return

  const trimmed = state.modal.editBuffer.trim()
  const newCustomCommands = { ...state.customCommands }
  if (trimmed) {
    newCustomCommands[assistantId] = trimmed
  } else {
    delete newCustomCommands[assistantId]
  }

  saveConfig({
    ...loadConfig(),
    customCommands: newCustomCommands,
  })
  dispatch({ customCommands: newCustomCommands, type: 'set-custom-commands' })
  dispatch({ type: 'cancel-command-edit' })
}

function applyThemeEffect(
  effect: Extract<SideEffect, { type: 'apply-theme' }>,
  ctx: SideEffectContext
): void {
  const { state } = ctx
  const filter = state.modal.type === 'theme-picker' ? state.modal.editBuffer : null
  const ids = filterThemeIds(filter)

  switch (effect.action) {
    case 'open':
      applyTheme(ctx.themeId)
      return
    case 'restore':
      applyTheme(ctx.themeId)
      return
    case 'confirm': {
      const selectedId = ids[state.modal.selectedIndex]
      if (selectedId) {
        applyTheme(selectedId)
        ctx.setThemeId(selectedId)
        saveConfig({ ...loadConfig(), themeId: selectedId })
      }
      return
    }
    case 'preview': {
      if (ids.length === 0) return
      const nextIndex = (state.modal.selectedIndex + effect.delta + ids.length) % ids.length
      const previewId = ids[nextIndex]
      if (previewId) {
        applyTheme(previewId)
      }
      return
    }
  }
}

function confirmSplitSelection(ctx: SideEffectContext): void {
  const { dispatch, state } = ctx
  const option = getSelectedAssistantOption(state)
  const direction = state.modal.type === 'split-picker' ? state.modal.splitDirection : 'vertical'
  const customCommand = state.customCommands[option.id]
  const tab = createTabSession(option.id, customCommand, state.customCommands)
  dispatch({ type: 'close-modal' })
  executeSplitPane(ctx, direction, tab)
  dispatch({ focusMode: 'terminal-input', type: 'set-focus-mode' })
}

function createTabId(): string {
  return createPrefixedId('tab')
}

function getSelectedSession(state: AppState) {
  const filter = state.modal.type === 'session-picker' ? state.modal.editBuffer : null
  return filterSessions(state.sessions, filter)[state.modal.selectedIndex]
}

function getSelectedSnippet(state: AppState) {
  const filter = state.modal.type === 'snippet-picker' ? state.modal.editBuffer : null
  return filterSnippets(state.snippets, filter)[state.modal.selectedIndex]
}

export function createTabSession(
  assistant: AssistantId,
  customCommand?: string,
  customCommands?: Record<string, string>
): TabSession {
  const allOptions = getAllAssistantOptions(customCommands ?? {})
  const option = allOptions.find((o) => o.id === assistant) ?? getAssistantOption(0)

  return {
    activity: 'idle',
    assistant,
    buffer: '',
    command: customCommand ?? option.command,
    id: createTabId(),
    scrollIntent: DEFAULT_SCROLL_INTENT,
    status: 'starting',
    terminalModes: createDefaultTerminalModes(),
    title: option.label,
  }
}

export function startTabSession(
  backend: SessionBackend,
  dispatch: (action: AppAction) => void,
  clearStartupGrace: (tabId: string) => void,
  startStartupGrace: (tabId: string) => void,
  tab: Pick<TabSession, 'id' | 'assistant' | 'title' | 'command'>,
  cols: number,
  rows: number,
  cwd?: string
): void {
  logInputDebug('app.tab.start.request', {
    cols,
    command: tab.command,
    cwd: cwd ?? null,
    rows,
    tabId: tab.id,
    title: tab.title,
  })
  startStartupGrace(tab.id)

  const { args, executable } = parseCommand(tab.command)

  if (!isCommandAvailable(executable)) {
    clearStartupGrace(tab.id)
    dispatch({
      message: `[command not found] ${executable} is not available in PATH.`,
      tabId: tab.id,
      type: 'set-tab-error',
    })
    return
  }

  backend.createSession({
    args,
    assistant: tab.assistant,
    cols,
    command: executable,
    cwd,
    rows,
    tabId: tab.id,
    title: tab.title,
  })
}

function launchAssistant(ctx: SideEffectContext, assistant: AssistantId): void {
  const { backend, clearStartupGrace, dispatch, startStartupGrace, state } = ctx
  const customCommand = state.customCommands[assistant]
  const tab = createTabSession(assistant, customCommand, state.customCommands)
  logInputDebug('app.launchAssistant', {
    assistant,
    command: tab.command,
    tabId: tab.id,
  })
  dispatch({ tab, type: 'add-tab' })
  dispatch({ focusMode: 'terminal-input', type: 'set-focus-mode' })
  startTabSession(
    backend,
    dispatch,
    clearStartupGrace,
    (tabId) => startStartupGrace(tabId, STARTUP_GRACE_MS),
    tab,
    state.layout.terminalCols,
    state.layout.terminalRows,
    ctx.getCurrentSessionProjectPath()
  )
}

function startExistingTab(ctx: SideEffectContext, tab: TabSession): void {
  const { backend, clearStartupGrace, dispatch, startStartupGrace, state } = ctx
  startTabSession(
    backend,
    dispatch,
    clearStartupGrace,
    (tabId) => startStartupGrace(tabId, STARTUP_GRACE_MS),
    tab,
    state.layout.terminalCols,
    state.layout.terminalRows,
    ctx.getCurrentSessionProjectPath()
  )
}

function executeSplitPane(
  ctx: SideEffectContext,
  direction: SplitDirection,
  tab: TabSession
): void {
  const { backend, clearStartupGrace, dispatch, startStartupGrace, state } = ctx
  const activeTabId = state.activeTabId
  if (!activeTabId) {
    return
  }

  const existingTree = getTreeForTab(state.layoutTrees, state.tabGroupMap, activeTabId)
  const baseTree = existingTree ?? createLeaf(activeTabId)
  const newTree = splitNode(baseTree, activeTabId, direction, tab.id)
  const bounds = createTerminalBounds(state.layout.terminalCols, state.layout.terminalRows)
  const paneRect = computePaneRects(newTree, bounds).get(tab.id)

  dispatch({ direction, newTab: tab, type: 'split-pane' })
  startTabSession(
    backend,
    dispatch,
    clearStartupGrace,
    (tabId) => startStartupGrace(tabId, STARTUP_GRACE_MS),
    tab,
    Math.max(1, (paneRect?.cols ?? state.layout.terminalCols) - PANE_BORDER * 2),
    Math.max(1, (paneRect?.rows ?? state.layout.terminalRows) - PANE_BORDER * 2),
    ctx.getCurrentSessionProjectPath()
  )
}

export function executeSideEffect(effect: SideEffect, ctx: SideEffectContext): void {
  const { backend, dispatch, state } = ctx

  switch (effect.type) {
    case 'quit': {
      saveCurrentWorkspace(effect.state)
      void backend.destroy(true)
      ctx.renderer.destroy()
      process.exit(0)
      return
    }
    case 'launch-selected-assistant': {
      const option = getSelectedAssistantOption(state)
      launchAssistant(ctx, option.id)
      return
    }
    case 'confirm-selected-session': {
      handleSessionSelection(ctx)
      return
    }
    case 'delete-selected-session': {
      handleSelectedSessionDelete(ctx)
      return
    }
    case 'delete-session': {
      handleDeleteSessionEffect(state, backend, dispatch, effect.sessionId)
      return
    }
    case 'open-rename-selected-session': {
      openSelectedSessionRename(ctx)
      return
    }
    case 'create-session':
      handleCreateSessionEffect(state, dispatch, effect.name, effect.projectPath)
      return
    case 'close-tab': {
      ctx.clearIdleTimer(effect.tabId)
      ctx.clearStartupGrace(effect.tabId)
      backend.disposeSession(effect.tabId)
      return
    }
    case 'restart-tab':
      restartTabSession(
        backend,
        dispatch,
        ctx.clearIdleTimer,
        ctx.clearStartupGrace,
        (tab) => startExistingTab(ctx, tab),
        effect.tab
      )
      return
    case 'paste-selected-snippet': {
      pasteSnippetToTab(
        backend,
        state.activeTabId,
        ctx.activeTab,
        getSelectedSnippet(state),
        dispatch
      )
      return
    }
    case 'paste-snippet-to-group': {
      pasteSnippetToActiveGroup(ctx)
      return
    }
    case 'edit-selected-snippet': {
      const snippet = getSelectedSnippet(state)
      if (snippet) {
        dispatch({ snippetId: snippet.id, type: 'open-snippet-editor' })
      }
      return
    }
    case 'delete-selected-snippet': {
      const snippet = getSelectedSnippet(state)
      if (snippet) {
        handleDeleteSnippetEffect(state.snippets, dispatch, snippet.id)
      }
      return
    }
    case 'save-snippet-editor': {
      handleSaveSnippetEditorEffect(state, dispatch)
      return
    }
    case 'save-custom-command': {
      saveCustomCommandSelection(ctx)
      return
    }
    case 'apply-theme': {
      applyThemeEffect(effect, ctx)
      return
    }
    case 'rename-session': {
      handleRenameSessionEffect(state.sessions, dispatch, effect.sessionId, effect.name)
      return
    }
    case 'split-pane': {
      const sourceTab = effect.sourceTabId
        ? state.tabs.find((t) => t.id === effect.sourceTabId)
        : undefined
      const assistant = sourceTab?.assistant ?? 'terminal'
      const customCommand = state.customCommands[assistant]
      const tab = createTabSession(assistant, customCommand, state.customCommands)
      executeSplitPane(ctx, effect.direction, tab)
      return
    }
    case 'confirm-split': {
      confirmSplitSelection(ctx)
      return
    }
    case 'scroll-git-diff': {
      scrollGitDiff(effect.delta)
      return
    }
    case 'persist-git-diff-mode-ratio': {
      const config = loadConfig()
      const persistedGitPane = config.gitPane
      const paneRatio = persistedGitPane?.paneRatio ?? persistedGitPane?.ratio ?? 0.5
      const embeddedRatio = persistedGitPane?.embeddedRatio ?? persistedGitPane?.ratio ?? 0.5
      saveConfig({
        ...config,
        gitPane: {
          diffModeRatio: effect.ratio,
          embeddedRatio,
          fileListMode: persistedGitPane?.fileListMode,
          mode: persistedGitPane?.mode ?? 'embedded',
          paneRatio,
          position: persistedGitPane?.position ?? 'bottom',
          treeCompaction: persistedGitPane?.treeCompaction,
          visible: persistedGitPane?.visible ?? true,
        },
      })
      return
    }
    case 'persist-git-file-list-mode': {
      const config = loadConfig()
      const persistedGitPane = config.gitPane
      const paneRatio = persistedGitPane?.paneRatio ?? persistedGitPane?.ratio ?? 0.5
      const embeddedRatio = persistedGitPane?.embeddedRatio ?? persistedGitPane?.ratio ?? 0.5
      saveConfig({
        ...config,
        gitPane: {
          diffModeRatio: persistedGitPane?.diffModeRatio,
          embeddedRatio,
          fileListMode: effect.mode,
          mode: persistedGitPane?.mode ?? 'embedded',
          paneRatio,
          position: persistedGitPane?.position ?? 'bottom',
          treeCompaction: persistedGitPane?.treeCompaction,
          visible: persistedGitPane?.visible ?? true,
        },
      })
      return
    }
    case 'persist-git-tree-compaction': {
      const config = loadConfig()
      const persistedGitPane = config.gitPane
      const paneRatio = persistedGitPane?.paneRatio ?? persistedGitPane?.ratio ?? 0.5
      const embeddedRatio = persistedGitPane?.embeddedRatio ?? persistedGitPane?.ratio ?? 0.5
      saveConfig({
        ...config,
        gitPane: {
          diffModeRatio: persistedGitPane?.diffModeRatio,
          embeddedRatio,
          fileListMode: persistedGitPane?.fileListMode,
          mode: persistedGitPane?.mode ?? 'embedded',
          paneRatio,
          position: persistedGitPane?.position ?? 'bottom',
          treeCompaction: effect.enabled,
          visible: persistedGitPane?.visible ?? true,
        },
      })
      return
    }
    case 'git-stage': {
      void enqueueGitOp(() => runGitAction(ctx, ['add', '--', effect.path], effect.path))
      return
    }
    case 'git-unstage': {
      void enqueueGitOp(() =>
        runGitAction(ctx, ['restore', '--staged', '--', effect.path], effect.path)
      )
      return
    }
    case 'git-stage-all': {
      const paths = ctx.state.gitPanel.files.map((f) => f.path)
      void enqueueGitOp(() => runGitActionAll(ctx, ['add', '-A'], paths))
      return
    }
    case 'git-unstage-all': {
      const paths = ctx.state.gitPanel.files.map((f) => f.path)
      void enqueueGitOp(() => runGitActionAll(ctx, ['reset'], paths))
      return
    }
    case 'git-restore': {
      void enqueueGitOp(() => runGitAction(ctx, ['restore', '--', effect.path], effect.path))
      return
    }
    case 'git-rm': {
      void enqueueGitOp(() => runGitRm(ctx, effect.path))
      return
    }
    case 'git-commit': {
      const { body, title } = effect
      void enqueueGitOp(() => runGitCommit(ctx, title, body))
      return
    }
    case 'git-commit-auto': {
      if (!isAutoCommitEnabled()) return
      const { body, title } = effect
      void enqueueGitOp(() => runGitCommitAuto(ctx, title, body))
      return
    }
    case 'generate-auto-commit-now': {
      if (!isAutoCommitEnabled()) return
      void runGenerateAutoCommitNow(ctx, effect.sessionId)
      return
    }
    case 'git-push': {
      void enqueueGitOp(() => runGitPush(ctx))
      return
    }
    case 'confirm-update-selection': {
      handleConfirmUpdateSelection(ctx)
      return
    }
    case 'switch-session-by-index': {
      handleSwitchSessionByIndex(ctx, effect.index)
      return
    }
    case 'toggle-transparent': {
      const next = !getTransparent()
      setTransparent(next)
      saveConfig({ ...loadConfig(), themeTransparent: next })
      return
    }
    case 'toggle-mode': {
      const next = getCurrentMode() === 'dark' ? 'light' : 'dark'
      setMode(next)
      saveConfig({ ...loadConfig(), themeMode: next })
      return
    }
    case 'open-file-in-editor': {
      openFileInEditor(ctx, effect.path)
      return
    }
    default:
      effect satisfies never
  }
}

function openFileInEditor(ctx: SideEffectContext, relPath: string): void {
  const config = getExternalEditorConfig()
  const rawCommand = config.command ?? process.env.VISUAL ?? process.env.EDITOR
  if (!rawCommand || rawCommand.trim() === '') {
    ctx.dispatch({
      message: 'no $EDITOR/$VISUAL set — configure externalEditor in aimux.config.ts',
      type: 'git-mode-set-message',
    })
    return
  }

  const fileEntry = ctx.state.gitPanel.files.find((f) => f.path === relPath)
  const cwd = fileEntry?.repoPath ?? ctx.getCurrentSessionProjectPath()
  if (!cwd) {
    ctx.dispatch({ message: 'no working directory', type: 'git-mode-set-message' })
    return
  }
  const absolutePath = relPath.startsWith('/') ? relPath : `${cwd}/${relPath}`

  const cmdParts = shellSplit(rawCommand)
  const executable = cmdParts[0]
  if (!executable) {
    ctx.dispatch({ message: 'invalid editor command', type: 'git-mode-set-message' })
    return
  }
  const baseName = executable.split('/').pop() ?? executable
  const extraCmdArgs = cmdParts.slice(1)

  const kind: 'gui' | 'tui' = config.kind ?? (KNOWN_GUI_EDITORS.has(baseName) ? 'gui' : 'tui')

  const templateArgs = config.args ?? DEFAULT_EDITOR_ARGS[baseName] ?? ['{file}']
  const resolvedArgs = [
    ...extraCmdArgs,
    ...templateArgs.map((a) => a.replaceAll('{file}', absolutePath).replaceAll('{line}', '1')),
  ]

  if (!isCommandAvailable(executable)) {
    ctx.dispatch({
      message: `editor not found in PATH: ${executable}`,
      type: 'git-mode-set-message',
    })
    return
  }

  if (kind === 'gui') {
    spawnDetached(ctx, [executable, ...resolvedArgs], cwd)
    return
  }

  // TUI editor — if the user explicitly configured `terminal`, spawn a new
  // terminal window with their template. Otherwise default to inline shellout:
  // suspend the renderer, hand the TTY to the editor, resume on exit.
  if (config.terminal && config.terminal.length > 0) {
    const shellCmd = buildShellCmd(cwd, executable, resolvedArgs)
    const argv = config.terminal.map((a) =>
      a.replaceAll('{cmd}', shellCmd).replaceAll('{cwd}', cwd)
    )
    spawnDetached(ctx, argv, cwd)
    return
  }

  void openEditorInline(ctx, executable, resolvedArgs, cwd)
}

function shellQuote(s: string): string {
  return `'${s.replaceAll("'", `'\\''`)}'`
}

/**
 * Minimal POSIX shell-word splitter — respects single/double quotes and
 * backslash escapes so values like `EDITOR='/Applications/My Editor/bin/code'`
 * or `EDITOR="code --user-data-dir \"/tmp/foo bar\""` tokenize correctly.
 * Does not expand variables or globs.
 */
function shellSplit(input: string): string[] {
  const out: string[] = []
  let current = ''
  let inSingle = false
  let inDouble = false
  let hasToken = false
  for (let i = 0; i < input.length; i++) {
    const c = input[i] ?? ''
    if (!inSingle && !inDouble && /\s/.test(c)) {
      if (hasToken) {
        out.push(current)
        current = ''
        hasToken = false
      }
      continue
    }
    hasToken = true
    if (c === "'" && !inDouble) {
      inSingle = !inSingle
    } else if (c === '"' && !inSingle) {
      inDouble = !inDouble
    } else if (c === '\\' && !inSingle && i + 1 < input.length) {
      current += input[++i]
    } else {
      current += c
    }
  }
  if (hasToken) out.push(current)
  return out
}

function buildShellCmd(cwd: string, executable: string, args: string[]): string {
  const quoted = [executable, ...args].map(shellQuote).join(' ')
  return `cd ${shellQuote(cwd)} && ${quoted}`
}

function spawnDetached(ctx: SideEffectContext, argv: string[], cwd?: string): void {
  try {
    const child = Bun.spawn(argv, {
      cwd,
      stderr: 'pipe',
      stdin: 'ignore',
      stdout: 'ignore',
    })
    void (async () => {
      const stderr = await new Response(child.stderr).text()
      const code = await child.exited
      if (code !== 0) {
        const firstLine = stderr.trim().split('\n')[0] || `exit ${code}`
        ctx.dispatch({ message: `editor: ${firstLine}`, type: 'git-mode-set-message' })
      }
    })()
    child.unref()
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'failed to spawn'
    ctx.dispatch({ message: `editor: ${msg}`, type: 'git-mode-set-message' })
  }
}

/**
 * Suspend the opentui renderer, hand the TTY to the editor (inheriting
 * stdin/stdout/stderr), then resume and force a redraw on exit. Matches the
 * shellout pattern used by opencode (packages/opencode/src/cli/cmd/tui/util/editor.ts).
 */
async function openEditorInline(
  ctx: SideEffectContext,
  executable: string,
  args: string[],
  cwd: string
): Promise<void> {
  const { renderer } = ctx
  renderer.suspend()
  renderer.currentRenderBuffer.clear()
  try {
    const proc = Bun.spawn([executable, ...args], {
      cwd,
      stderr: 'inherit',
      stdin: 'inherit',
      stdout: 'inherit',
    })
    await proc.exited
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'failed to spawn editor'
    ctx.dispatch({ message: `editor: ${msg}`, type: 'git-mode-set-message' })
  } finally {
    renderer.currentRenderBuffer.clear()
    renderer.resume()
    renderer.requestRender()
  }
}

function handleSwitchSessionByIndex(ctx: SideEffectContext, index: number): void {
  const { backend, dispatch, state } = ctx
  const ordered = state.sessions
    .slice()
    .sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER))
  const target = ordered[index - 1]
  if (!target) {
    logInputDebug('app.sessionBar.switchOutOfRange', { index, total: ordered.length })
    return
  }
  if (target.id === state.currentSessionId) {
    if (state.focusMode === 'git') {
      dispatch({ type: 'exit-git-mode' })
    }
    return
  }
  handleSwitchSessionEffect(state, backend, dispatch, target)
}

function handleConfirmUpdateSelection(ctx: SideEffectContext): void {
  const { state } = ctx
  if (state.modal.type !== 'update-available') {
    return
  }
  const latest = state.modal.latestVersion
  if (state.modal.selectedIndex === 0) {
    runUpdateFromTui(ctx, latest)
    return
  }
  saveConfig({ ...loadConfig(), skippedUpdateVersion: latest })
}

function runUpdateFromTui(ctx: SideEffectContext, latestVersion: string): void {
  saveCurrentWorkspace(ctx.state)
  void ctx.backend.destroy(true)
  ctx.renderer.destroy()
  process.stdout.write(`\nUpdating aimux to ${latestVersion}...\n`)
  const proc = Bun.spawn(['bun', 'update', '-g', '@brimveyn/aimux', '@brimveyn/aimux-config'], {
    stderr: 'inherit',
    stdin: 'inherit',
    stdout: 'inherit',
  })
  void proc.exited.then((code) => {
    if (code === 0) {
      process.stdout.write(`\nUpdated. Run \`aimux\` to start the new version.\n`)
    } else {
      process.stderr.write(`\nUpdate failed (exit code ${code}).\n`)
    }
    process.exit(code ?? 1)
  })
}

async function runGitAction(
  ctx: SideEffectContext,
  args: string[],
  pathToInvalidate?: string
): Promise<void> {
  const fallback = ctx.getCurrentSessionProjectPath()
  const repoPath = pathToInvalidate
    ? ctx.state.gitPanel.files.find((f) => f.path === pathToInvalidate)?.repoPath
    : undefined
  const cwd = repoPath ?? fallback
  if (!cwd) return
  const result = await $`git -C ${cwd} ${args}`.quiet().nothrow()
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim()
    ctx.dispatch({ message: stderr || 'git action failed', type: 'git-mode-set-message' })
    return
  }
  ctx.dispatch({ message: null, type: 'git-mode-set-message' })
  if (pathToInvalidate) {
    ctx.dispatch({ path: pathToInvalidate, type: 'git-mode-clear-diff-cache' })
  }
}

async function runGitActionAll(
  ctx: SideEffectContext,
  args: string[],
  pathsToInvalidate: string[]
): Promise<void> {
  const cwd = ctx.getCurrentSessionProjectPath()
  if (!cwd) return
  const result = await $`git -C ${cwd} ${args}`.quiet().nothrow()
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim()
    ctx.dispatch({ message: stderr || 'git action failed', type: 'git-mode-set-message' })
    return
  }
  ctx.dispatch({ message: null, type: 'git-mode-set-message' })
  if (pathsToInvalidate.length > 0) {
    ctx.dispatch({ paths: pathsToInvalidate, type: 'git-mode-invalidate-diffs' })
  }
}

async function runGitRm(ctx: SideEffectContext, path: string): Promise<void> {
  const repoPath = ctx.state.gitPanel.files.find((f) => f.path === path)?.repoPath
  const cwd = repoPath ?? ctx.getCurrentSessionProjectPath()
  if (!cwd) return
  const absolute = `${cwd}/${path}`
  try {
    const stat = await Bun.file(absolute).stat()
    if (stat.isDirectory()) {
      await Bun.$`rm -rf -- ${absolute}`.quiet().nothrow()
    } else {
      await Bun.file(absolute).unlink()
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'failed to delete file'
    ctx.dispatch({ message, type: 'git-mode-set-message' })
    return
  }
  ctx.dispatch({ message: null, type: 'git-mode-set-message' })
  ctx.dispatch({ path, type: 'git-mode-clear-diff-cache' })
}

async function runGitCommit(ctx: SideEffectContext, title: string, body: string): Promise<void> {
  const cwd = ctx.getCurrentSessionProjectPath()
  if (!cwd) return
  if (!title) {
    ctx.dispatch({ message: 'empty commit title', type: 'git-mode-set-message' })
    return
  }
  const result = body
    ? await $`git -C ${cwd} commit -m ${title} -m ${body}`.quiet().nothrow()
    : await $`git -C ${cwd} commit -m ${title}`.quiet().nothrow()
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim()
    ctx.dispatch({
      message: stderr || 'commit failed',
      type: 'git-mode-set-message',
    })
    return
  }
  clearAutoCommitForCurrentSession(ctx)
  ctx.dispatch({ message: `committed: ${title}`, type: 'git-mode-set-message' })
}

async function runGitCommitAuto(
  ctx: SideEffectContext,
  title: string,
  body: string
): Promise<void> {
  if (!title) {
    ctx.dispatch({ message: 'empty commit title', type: 'git-mode-set-message' })
    return
  }
  const cwd = ctx.getCurrentSessionProjectPath()
  if (!cwd) return

  // If the user has manually staged files, respect that intent and commit
  // only the staged set — don't run `git add -A` which would sweep up
  // unrelated unstaged/untracked changes. With nothing staged, `add -A`
  // keeps the "commit everything" behaviour the user expects from auto-commit.
  const hasStaged = ctx.state.gitPanel.files.some((f) => f.section === 'staged')
  if (!hasStaged) {
    const addArgs = ['add', '-A']
    const addResult = await $`git -C ${cwd} ${addArgs}`.quiet().nothrow()
    if (addResult.exitCode !== 0) {
      ctx.dispatch({
        message: addResult.stderr.toString().trim() || 'auto-commit: git add failed',
        type: 'git-mode-set-message',
      })
      return
    }
  }

  const commitResult = body
    ? await $`git -C ${cwd} commit -m ${title} -m ${body}`.quiet().nothrow()
    : await $`git -C ${cwd} commit -m ${title}`.quiet().nothrow()

  if (commitResult.exitCode !== 0) {
    ctx.dispatch({
      message: commitResult.stderr.toString().trim() || 'auto-commit: commit failed',
      type: 'git-mode-set-message',
    })
    return
  }

  clearAutoCommitForCurrentSession(ctx)
  ctx.dispatch({ message: `committed: ${title}`, type: 'git-mode-set-message' })
}

function clearAutoCommitForCurrentSession(ctx: SideEffectContext): void {
  const sessionId = ctx.state.currentSessionId
  if (!sessionId) return
  ctx.dispatch({ sessionId, type: 'auto-commit-clear' })
}

async function runGenerateAutoCommitNow(ctx: SideEffectContext, sessionId: string): Promise<void> {
  const session = ctx.state.sessions.find((s) => s.id === sessionId)
  const panel = ctx.state.gitPanel
  if (panel.error !== null) {
    ctx.dispatch({ message: 'auto-commit: git panel unavailable', type: 'git-mode-set-message' })
    ctx.dispatch({ sessionId, type: 'auto-commit-clear' })
    return
  }
  const tab = ctx.activeTab
  if (!tab) {
    ctx.dispatch({
      message: 'auto-commit: no active assistant tab — open a claude/codex session first',
      type: 'git-mode-set-message',
    })
    ctx.dispatch({ sessionId, type: 'auto-commit-clear' })
    return
  }
  await triggerAutoCommitNow({
    assistant: tab.assistant,
    git: {
      ahead: panel.ahead,
      behind: panel.behind,
      branch: panel.branch,
      files: panel.files,
    },
    projectPath: session?.projectPath,
    sessionId,
    tabId: tab.id,
  })
}

async function runGitPush(ctx: SideEffectContext): Promise<void> {
  const cwd = ctx.getCurrentSessionProjectPath()
  if (!cwd) return
  ctx.dispatch({ message: 'pushing…', type: 'git-mode-set-message' })

  const upstream = await $`git -C ${cwd} rev-parse --abbrev-ref --symbolic-full-name @{u}`
    .quiet()
    .nothrow()
  const hasUpstream = upstream.exitCode === 0

  const result = hasUpstream
    ? await $`git -C ${cwd} push`.quiet().nothrow()
    : await $`git -C ${cwd} push --set-upstream origin HEAD`.quiet().nothrow()

  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim()
    ctx.dispatch({
      message: stderr || 'push failed',
      type: 'git-mode-set-message',
    })
    return
  }
  ctx.dispatch({ message: 'pushed', type: 'git-mode-set-message' })
}
