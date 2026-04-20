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
import { applyTheme, getTransparent, setTransparent } from '../ui/theme'
import { type ThemeId } from '../ui/themes'
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
  renderer: { destroy(): void }
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
    handleDeleteSessionEffect(state, backend, dispatch, selectedSession.id)
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
      saveConfig({
        ...config,
        gitPane: {
          diffModeRatio: effect.ratio,
          fileListMode: persistedGitPane?.fileListMode,
          mode: persistedGitPane?.mode ?? 'embedded',
          position: persistedGitPane?.position ?? 'bottom',
          ratio: persistedGitPane?.ratio ?? 0.5,
          treeCompaction: persistedGitPane?.treeCompaction,
          visible: persistedGitPane?.visible ?? true,
        },
      })
      return
    }
    case 'persist-git-file-list-mode': {
      const config = loadConfig()
      const persistedGitPane = config.gitPane
      saveConfig({
        ...config,
        gitPane: {
          diffModeRatio: persistedGitPane?.diffModeRatio,
          fileListMode: effect.mode,
          mode: persistedGitPane?.mode ?? 'embedded',
          position: persistedGitPane?.position ?? 'bottom',
          ratio: persistedGitPane?.ratio ?? 0.5,
          treeCompaction: persistedGitPane?.treeCompaction,
          visible: persistedGitPane?.visible ?? true,
        },
      })
      return
    }
    case 'persist-git-tree-compaction': {
      const config = loadConfig()
      const persistedGitPane = config.gitPane
      saveConfig({
        ...config,
        gitPane: {
          diffModeRatio: persistedGitPane?.diffModeRatio,
          fileListMode: persistedGitPane?.fileListMode,
          mode: persistedGitPane?.mode ?? 'embedded',
          position: persistedGitPane?.position ?? 'bottom',
          ratio: persistedGitPane?.ratio ?? 0.5,
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
    case 'git-push': {
      void enqueueGitOp(() => runGitPush(ctx))
      return
    }
    case 'auto-commit-accept': {
      const { body, sessionId, title } = effect
      void enqueueGitOp(() => runAutoCommitAccept(ctx, sessionId, title, body))
      return
    }
    case 'auto-commit-dismiss': {
      ctx.dispatch({
        body: effect.body,
        sessionId: effect.sessionId,
        title: effect.title,
        type: 'auto-commit-dismiss',
      })
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
    default:
      effect satisfies never
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
  if (target.id === state.currentSessionId) return
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
  const cwd = ctx.getCurrentSessionProjectPath()
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

async function runGitRm(ctx: SideEffectContext, path: string): Promise<void> {
  const cwd = ctx.getCurrentSessionProjectPath()
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
  ctx.dispatch({ message: `committed: ${title}`, type: 'git-mode-set-message' })
}

async function runAutoCommitAccept(
  ctx: SideEffectContext,
  sessionId: string,
  title: string,
  body: string
): Promise<void> {
  if (!title) return
  const cwd = ctx.getCurrentSessionProjectPath()
  if (!cwd) return

  const addArgs = ['add', '-A']
  const addResult = await $`git -C ${cwd} ${addArgs}`.quiet().nothrow()
  if (addResult.exitCode !== 0) {
    ctx.dispatch({
      message: addResult.stderr.toString().trim() || 'auto-commit: git add failed',
      type: 'git-mode-set-message',
    })
    return
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

  ctx.dispatch({ sessionId, type: 'auto-commit-clear' })
  ctx.dispatch({ message: `committed: ${title}`, type: 'git-mode-set-message' })
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
