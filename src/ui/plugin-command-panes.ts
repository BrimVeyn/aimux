import type { PluginCommandPaneSpec } from '@brimveyn/aimux-plugin'

import type { SideEffectContext } from '../app-runtime/side-effect-context'
import type { PluginRecord } from '../plugins/types'
import type { TabSession } from '../state/types'

import { registerPluginEffect } from '../app-runtime/plugin-effects'
import { executeSplitPane } from '../app-runtime/tab-actions'
import { logDebug } from '../debug/input-log'
import { createPrefixedId } from '../platform/id'
import { shellQuote } from '../pty/command-registry'
import { appStore } from '../state/app-store'
import { dispatchGlobal, runSideEffectGlobal } from '../state/dispatch-ref'
import { getActiveWorkspace, getCurrentProject } from '../state/project-workspaces'
import { createDefaultTerminalModes } from '../state/terminal-modes'
import { toast } from '../state/toast-store'

/**
 * Panes that host a *program* — lazygit, yazi, a binary the plugin ships.
 *
 * A React pane draws; this one spawns. It is a real terminal tab that aimux
 * owns on the plugin's behalf, marked with `TabSession.pluginPane`, and the
 * whole of the lifecycle question is answered by that mark:
 *
 * - **Reload** re-registers the same qualified id, and `open` finds the tab
 *   already there. The program never notices the plugin restarted.
 * - **Unlink, uninstall, disable** take the plugin's record away, and
 *   `reconcileCommandPanes` closes every tab it marked. A program with no
 *   plugin behind it is a tab nobody can explain.
 * - **The program exits** and the tab stays, holding its last frame and a
 *   line saying so — the same choice the setup runner makes, for the same
 *   reason: the output is what the user needs to read.
 *
 * Declared panes (`manifest.panes[]`) are registered here by the host from the
 * record, not by the fiber, so a plugin with no TypeScript at all gets them and
 * they follow the record's life rather than a fiber's.
 */

export interface PluginCommandPaneDefinition {
  /** Qualified id, `<pluginId>.<paneId>`. */
  id: string
  pluginId: string
  title: string
  command: string[]
  cwd?: string
  /** The plugin's own directory, for `cwd: 'plugin'`. */
  pluginRoot: string
}

const panes = new Map<string, PluginCommandPaneDefinition>()

export function registerCommandPane(pane: PluginCommandPaneDefinition): () => void {
  panes.set(pane.id, pane)
  return () => {
    if (panes.get(pane.id) === pane) panes.delete(pane.id)
  }
}

export function getCommandPane(id: string): PluginCommandPaneDefinition | undefined {
  return panes.get(id)
}

/** Test seam. Never called by the app. */
export function clearCommandPanes(): void {
  panes.clear()
  declared.clear()
}

/** The tab a command pane is currently running in, if it is open. */
export function findCommandPaneTab(paneId: string): TabSession | undefined {
  return appStore.getState().tabs.find((tab) => tab.pluginPane === paneId)
}

/** Qualified ids of the command panes on screen, in tab order. */
export function openCommandPaneIds(): string[] {
  const ids: string[] = []
  for (const tab of appStore.getState().tabs) {
    if (tab.pluginPane !== undefined) ids.push(tab.pluginPane)
  }
  return ids
}

function resolveCwd(pane: PluginCommandPaneDefinition): string | undefined {
  const state = appStore.getState()
  const project = getCurrentProject(state)
  const which = pane.cwd ?? 'workspace'
  if (which === 'workspace') return getActiveWorkspace(project)?.path ?? project?.projectPath
  if (which === 'project') return project?.projectPath
  if (which === 'plugin') return pane.pluginRoot
  return which
}

/**
 * Opens one, as a side effect: spawning needs the effect context, and going
 * through the same executor a keybinding uses keeps `aimux action run`
 * honest about what a plugin's key does.
 */
export function openCommandPane(paneId: string, direction: 'horizontal' | 'vertical'): void {
  runSideEffectGlobal({
    effectId: OPEN_EFFECT,
    payload: { direction, paneId },
    pluginId: HOST_EFFECT_OWNER,
    type: 'plugin-effect',
  })
}

/** Closes the tab, which kills the program. A no-op when it is not open. */
export function closeCommandPane(paneId: string): void {
  const tab = findCommandPaneTab(paneId)
  if (!tab) return
  dispatchGlobal({ tabId: tab.id, type: 'close-tab' })
  runSideEffectGlobal({ tabId: tab.id, type: 'close-tab' })
}

/**
 * `aimux` is not a legal plugin id, so the host can own effects under it
 * without colliding with anything a plugin registers.
 */
const HOST_EFFECT_OWNER = 'aimux'
const OPEN_EFFECT = 'open-command-pane'

function openInContext(
  ctx: SideEffectContext,
  paneId: string,
  direction: 'horizontal' | 'vertical'
): void {
  const pane = panes.get(paneId)
  if (!pane) {
    toast.error(`plugin pane ${paneId} is not registered`)
    return
  }
  const existing = findCommandPaneTab(paneId)
  if (existing) {
    // One instance per id, and asking again means "show me": the keyboard
    // goes to it, which is what the user pressing the plugin's key wanted.
    ctx.dispatch({ tabId: existing.id, type: 'set-active-tab' })
    return
  }
  const { state } = ctx
  const tab: TabSession = {
    activity: 'idle',
    assistant: 'terminal',
    buffer: '',
    command: pane.command.map(shellQuote).join(' '),
    id: createPrefixedId('tab'),
    pluginPane: paneId,
    status: 'starting',
    terminalModes: createDefaultTerminalModes(),
    title: pane.title,
    workspaceId: getActiveWorkspace(getCurrentProject(state))?.id,
  }
  const cwd = resolveCwd(pane)
  logDebug('plugin.commandPane.open', { command: pane.command, cwd, paneId, tabId: tab.id })
  if (state.activeTabId != null && state.activeTabId !== '') {
    executeSplitPane(ctx, direction, tab, { autoRenameCandidate: false, cwd })
    return
  }
  // Nothing to split: the pane becomes the first tab, as a launch would.
  ctx.dispatch({ tab, type: 'add-tab' })
  ctx.dispatch({ focusMode: 'terminal-input', type: 'set-focus-mode' })
  runSideEffectGlobal({ tab, type: 'restart-tab' })
}

let effectInstalled = false

/**
 * Installs the host effect once. Called by the UI plugin host on mount rather
 * than at import, so a test that never mounts one registers nothing.
 */
export function installCommandPaneEffect(): () => void {
  if (effectInstalled) return () => {}
  effectInstalled = true
  const dispose = registerPluginEffect(HOST_EFFECT_OWNER, OPEN_EFFECT, (payload, ctx) => {
    const request = payload as { paneId?: unknown; direction?: unknown }
    if (typeof request.paneId !== 'string') return
    openInContext(
      ctx,
      request.paneId,
      request.direction === 'horizontal' ? 'horizontal' : 'vertical'
    )
  })
  return () => {
    effectInstalled = false
    dispose()
  }
}

/**
 * What to do when the program behind a pane exits: keep the tab, say so.
 * Returns true when the tab was a command pane and has been handled.
 */
export function recordCommandPaneExit(tabId: string, exitCode: number): boolean {
  const tab = appStore.getState().tabs.find((entry) => entry.id === tabId)
  if (tab?.pluginPane === undefined) return false
  dispatchGlobal({
    message: `${tab.title} exited with code ${exitCode}. Press Ctrl+r to run it again.`,
    tabId,
    type: 'set-tab-error',
  })
  return true
}

/** Declared panes registered from records, by plugin id, so a record change can withdraw them. */
const declared = new Map<string, { root: string; dispose: () => void }>()

function declaredPane(
  record: PluginRecord,
  spec: PluginCommandPaneSpec
): PluginCommandPaneDefinition {
  return {
    command: spec.command,
    id: `${record.id}.${spec.id}`,
    pluginId: record.id,
    pluginRoot: record.root,
    title: spec.title ?? spec.id,
    ...(spec.cwd === undefined ? {} : { cwd: spec.cwd }),
  }
}

/**
 * Makes the registry and the screen agree with the records: manifest panes of
 * every enabled plugin are registered, and every open pane whose plugin is
 * gone — unlinked, uninstalled, disabled — is closed, program included.
 */
export function reconcileCommandPanes(records: readonly PluginRecord[]): void {
  const alive = new Map<string, PluginRecord>()
  for (const record of records) {
    if (record.enabled) alive.set(record.id, record)
  }

  for (const [pluginId, entry] of declared) {
    const record = alive.get(pluginId)
    if (record && record.root === entry.root && (record.manifest.panes?.length ?? 0) > 0) continue
    entry.dispose()
    declared.delete(pluginId)
  }
  for (const record of alive.values()) {
    const specs = record.manifest.panes ?? []
    if (specs.length === 0 || declared.has(record.id)) continue
    const disposers = specs.map((spec) => registerCommandPane(declaredPane(record, spec)))
    declared.set(record.id, {
      dispose: () => {
        for (const dispose of disposers) dispose()
      },
      root: record.root,
    })
  }

  for (const paneId of openCommandPaneIds()) {
    const owner = [...alive.keys()].find((id) => paneId.startsWith(`${id}.`))
    if (owner !== undefined) continue
    logDebug('plugin.commandPane.closeOrphan', { paneId })
    closeCommandPane(paneId)
  }
}
