import type { AppAction } from '../state/actions'
import type { ProjectRecord, TabSession, WorkspaceRecord } from '../state/types'
import type { SideEffectContext } from './side-effect-context'

import { logInputDebug } from '../debug/input-log'
import { shellQuote } from '../pty/command-registry'
import { appStore } from '../state/app-store'
import { saveProjectCatalog } from '../state/project-catalog'
import { ensureSetupScriptStub, getProjectDataDir, getSetupScriptPath } from '../state/project-data'
import { findWorkspace, getCurrentProject } from '../state/project-workspaces'
import { toast } from '../state/toast-store'
import { getActiveWorkspace, getActiveWorkspacePath } from '../state/workspace-view'
import { launchEditorOnFile } from './editor-actions'
import { createTabSession, startTabSession } from './tab-actions'

/**
 * The setup tab starts before its host is on screen (or without a host at all —
 * the widget is opt-in), so it has no measured box yet. This bootstrap size also
 * has to lift the backend's paneReady gate: while that gate is closed every
 * render is buffered, and a setup running behind a hidden widget would produce
 * no viewport ever. The widget's own measurement corrects the size later.
 */
const BOOTSTRAP_COLS = 80
const BOOTSTRAP_ROWS = 24

/**
 * The setup tab the widget owns for this workspace. Hidden is part of the
 * predicate: a promoted tab is a normal tab in the main pane, so the widget must
 * stop rendering and sizing it — two hosts reporting a measurement for one PTY
 * never settle on a size.
 */
export function findSetupTab(
  tabs: TabSession[],
  workspaceId: string | undefined
): TabSession | undefined {
  if (workspaceId == null || workspaceId === '') return undefined
  return tabs.find(
    (tab) => tab.role === 'setup' && tab.hidden === true && tab.workspaceId === workspaceId
  )
}

/**
 * Stamp a finished setup run onto its workspace record. Returns whether the tab
 * was a setup tab, which is the caller's signal to leave it open.
 *
 * The workspace record — not the tab — is what tells the widget a run finished,
 * so no new TabStatus is needed for "exited but still on screen".
 */
export function recordSetupExit(
  tabId: string,
  exitCode: number,
  dispatch: (action: AppAction) => void
): boolean {
  const { projects, tabs } = appStore.getState()
  const tab = tabs.find((entry) => entry.id === tabId)
  if (tab?.role !== 'setup') return false

  // A promoted tab is no longer the one the widget owns, but its exit is still
  // the latest thing that happened to this workspace — unless a newer run has
  // started since, which is the only case where this result is stale news.
  // Reporting is not optional: without it, promoting a setup to watch it fail
  // means watching it fail in silence.
  const superseded = tab.hidden !== true && findSetupTab(tabs, tab.workspaceId) !== undefined
  const found = findWorkspace(projects, tab.workspaceId)
  if (superseded || !found) return true
  const { project, workspace } = found

  dispatch({
    patch: { setupExitCode: exitCode, setupRanAt: new Date().toISOString() },
    projectId: project.id,
    type: 'update-workspace-record',
    workspaceId: workspace.id,
  })
  saveProjectCatalog(appStore.getState().projects)
  logInputDebug('setup.exit', {
    exitCode,
    projectId: project.id,
    tabId,
    workspaceId: workspace.id,
  })

  // The widget is opt-in, so a failure has to reach a user who never added it.
  // Success stays quiet.
  if (exitCode !== 0) {
    toast.error(`Setup failed in ${workspace.name} — exit ${exitCode}`)
  }
  return true
}

function resolveTarget(
  ctx: SideEffectContext
): { project: ProjectRecord; workspace: WorkspaceRecord } | undefined {
  const project = getCurrentProject(ctx.getState())
  const workspace = getActiveWorkspace(project)
  if (!project || !workspace) return undefined
  return { project, workspace }
}

/**
 * Spawn the hidden PTY that runs a project's setup script in one workspace.
 * Replaces any existing setup tab for that workspace, so Run and Re-run are the
 * same path.
 */
export function runSetup(ctx: SideEffectContext, projectId: string, workspace: WorkspaceRecord) {
  const existing = findSetupTab(ctx.getState().tabs, workspace.id)
  if (existing) {
    ctx.backend.disposeSession(existing.id)
    ctx.dispatch({ tabId: existing.id, type: 'close-tab' })
  }

  const scriptPath = getSetupScriptPath(projectId)
  const tab: TabSession = {
    // Quoted, not interpolated bare: the path sits under $HOME, which can hold a
    // space or an apostrophe.
    ...createTabSession('terminal', `bash ${shellQuote(scriptPath)}`, {}, workspace.id),
    hidden: true,
    role: 'setup',
    title: 'Setup',
  }

  ctx.dispatch({
    patch: { setupExitCode: undefined, setupRanAt: undefined },
    projectId,
    type: 'update-workspace-record',
    workspaceId: workspace.id,
  })
  ctx.dispatch({ tab, type: 'add-tab' })
  startTabSession(ctx, tab, {
    autoRenameCandidate: false,
    cols: BOOTSTRAP_COLS,
    cwd: workspace.path,
    rows: BOOTSTRAP_ROWS,
  })
  // Lifts the render gate immediately — see BOOTSTRAP_COLS.
  ctx.backend.resizeTab(tab.id, BOOTSTRAP_COLS, BOOTSTRAP_ROWS, {
    confirmedFromMeasurement: true,
  })
  logInputDebug('setup.run', { projectId, scriptPath, tabId: tab.id, workspaceId: workspace.id })
  return tab.id
}

export function handleRunSetupEffect(ctx: SideEffectContext): void {
  const target = resolveTarget(ctx)
  if (!target) {
    toast.error('Open a workspace first')
    return
  }
  runSetup(ctx, target.project.id, target.workspace)
}

export function handleStopSetupEffect(ctx: SideEffectContext): void {
  const target = resolveTarget(ctx)
  if (!target) return
  const tab = findSetupTab(ctx.getState().tabs, target.workspace.id)
  if (!tab) return
  ctx.backend.disposeSession(tab.id)
  ctx.dispatch({ tabId: tab.id, type: 'close-tab' })
}

/**
 * `projectId` names a project other than the current one — the settings screen
 * lists every project, and a script too long for one field hands over to here.
 * Without it, the current project's active workspace is the target.
 */
export function handleConfigureSetupScriptEffect(ctx: SideEffectContext, projectId?: string): void {
  const state = ctx.getState()
  const project =
    projectId != null && projectId !== ''
      ? state.projects.find((entry) => entry.id === projectId)
      : getCurrentProject(state)
  if (!project) {
    toast.error('Open a project first')
    return
  }
  // The editor's working directory: this project's active workspace if it has
  // one, else wherever the project itself lives, else the script's own home —
  // a GUI editor ignores it, a TUI one needs somewhere to be.
  const cwd =
    getActiveWorkspacePath(project) ?? project.projectPath ?? getProjectDataDir(project.id)
  launchEditorOnFile(ctx, ensureSetupScriptStub(project.id), cwd, (message) =>
    toast.error(`editor: ${message}`)
  )
}

/**
 * Promote the setup tab to a normal focusable tab. A failing setup means reading
 * a stack trace, which a bar 30 columns wide cannot do.
 */
export function handlePromoteSetupTabEffect(ctx: SideEffectContext): void {
  const target = resolveTarget(ctx)
  if (!target) return
  const tab = findSetupTab(ctx.getState().tabs, target.workspace.id)
  if (!tab) return
  ctx.dispatch({ hidden: false, tabId: tab.id, type: 'update-tab-metadata' })
  ctx.dispatch({ tabId: tab.id, type: 'set-active-tab' })
}

export function buildSetupAgentPrompt(scriptPath: string): string {
  return `Write the setup script for this project.

aimux creates each workspace as a fresh \`git worktree\`. That checkout contains only files tracked by git — no .env, no node_modules, no .venv, no build cache, no local database. The setup script's job is to take that bare checkout to a state where the project builds, tests, and runs.

Inspect this repository and work out what that takes: package manifests and their lockfiles, the package manager actually in use, .env.example or equivalent templates, database migrations, code generation steps, native builds, and whatever the README or CONTRIBUTING tells a new contributor to do.

A stub already exists at exactly this absolute path. Read it, then replace its contents:

    ${scriptPath}

It lives outside the repository on purpose, so every workspace of this project shares one script. Do not move it into the repo.

Requirements:
- \`#!/usr/bin/env bash\` and \`set -euo pipefail\`.
- Runs with the working directory set to the workspace root. Use relative paths; never hardcode a worktree path, they differ per workspace.
- Idempotent: safe to run twice in a row.
- Non-interactive: no prompts, no sudo, no password reads, no browser logins. If a step needs a human, print a clear instruction and keep going.
- Never write a secret into the script. Copy .env.example to .env and print which values the user still has to fill in.
- Exit non-zero if a required step fails; aimux surfaces the exit code.
- Echo a short line before each step so the output is readable in a narrow pane.

When you are done, print the script's path and a one-line summary of what it does. Do not run it.`
}

export function handleAskAgentForSetupScriptEffect(ctx: SideEffectContext): void {
  const target = resolveTarget(ctx)
  if (!target) {
    toast.error('Open a project first')
    return
  }
  // Create the stub first: the agent then edits a file it can read, rather than
  // creating one at an absolute path outside its working directory.
  const path = ensureSetupScriptStub(target.project.id)
  ctx.dispatch({ pendingPrompt: buildSetupAgentPrompt(path), type: 'open-new-tab-modal' })
}
