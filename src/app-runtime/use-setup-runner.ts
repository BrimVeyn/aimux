import { useEffect, useRef } from 'react'

import type { AppState, ProjectRecord, TabSession, WorkspaceRecord } from '../state/types'
import type { SideEffectContext } from './side-effect-context'

import { hasSetupScript } from '../state/project-data'
import { findSetupTab, runSetup } from './setup-actions'

export interface SetupCandidate {
  projectId: string
  workspace: WorkspaceRecord
}

/**
 * Which workspaces should have their setup script run right now.
 *
 * The trigger is "a workspace id this session has not seen before", not "a
 * workspace became active". Activation is the wrong signal: `j`/`k` cycles
 * workspaces, so an activation-based rule would fire the script in every
 * workspace the user scrolls past. Watching the id set also means one rule
 * covers both creation paths — the TUI's `<C-p>` and `aimux workspace create`
 * arriving over the daemon — instead of a hook per call site, which is how the
 * CLI path ends up silently skipping setup.
 *
 * Mutates `seenByProject`: every id examined is marked seen, so a workspace is
 * only ever a candidate once.
 */
export function collectSetupCandidates(
  projects: ProjectRecord[],
  tabs: TabSession[],
  seenByProject: Map<string, Set<string>>,
  hasScript: (projectId: string) => boolean
): SetupCandidate[] {
  const candidates: SetupCandidate[] = []

  for (const project of projects) {
    const seen = seenByProject.get(project.id)
    const workspaces = project.workspaces ?? []

    // First sight of a project: record what it already has and run nothing.
    // Without this, switching to a project surfaces N pre-existing workspaces
    // at once and would fire N setups.
    if (!seen) {
      seenByProject.set(project.id, new Set(workspaces.map((w) => w.id)))
      continue
    }

    for (const workspace of workspaces) {
      if (seen.has(workspace.id)) continue
      seen.add(workspace.id)

      // The primary workspace *is* the user's real repo checkout. Running a
      // script that does `cp .env.example .env` over it would clobber their
      // actual .env.
      if (workspace.source === 'primary') continue
      if (!hasScript(project.id)) continue
      if (findSetupTab(tabs, workspace.id)) continue

      candidates.push({ projectId: project.id, workspace })
    }
  }

  return candidates
}

/**
 * Runs a project's setup script once per newly created workspace.
 *
 * ponytail: a workspace created by the CLI while the app is closed is seeded as
 * pre-existing on the next boot and never auto-runs. The widget's Run button
 * covers it; compare createdAt against setupRanAt if that turns out to matter.
 *
 * The outcome is recorded by `recordSetupExitIfHidden`, called from the
 * backend's exit event, which already carries the exit code.
 */
export function useSetupRunner(state: AppState, ctx: SideEffectContext): void {
  const seenByProject = useRef(new Map<string, Set<string>>())
  const ctxRef = useRef(ctx)
  ctxRef.current = ctx

  useEffect(() => {
    const candidates = collectSetupCandidates(
      state.projects,
      state.tabs,
      seenByProject.current,
      hasSetupScript
    )
    for (const { projectId, workspace } of candidates) {
      runSetup(ctxRef.current, projectId, workspace)
    }
  }, [state.projects, state.tabs])
}
