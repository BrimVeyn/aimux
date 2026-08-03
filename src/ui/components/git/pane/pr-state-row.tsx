import { memo, useCallback, useState } from 'react'

import { approveAndMergePr } from '../../../../git/pr-merge'
import { type PrActionState, prActionState } from '../../../../git/pr-status'
import { refreshPrStatus } from '../../../../git/pr-status-poller'
import { openUrl } from '../../../../platform/open-url'
import { useAppStore } from '../../../../state/app-store'
import { runSideEffectGlobal } from '../../../../state/dispatch-ref'
import { usePrStatusStore } from '../../../../state/pr-status-store'
import { getActiveWorkspace } from '../../../../state/project-workspaces'
import { toast } from '../../../../state/toast-store'
import { useBusySpinner } from '../../../hooks/use-busy-spinner'
import { type ResolvedTuiTheme, useTheme, useTransparent } from '../../../theme'

function toneColor(tone: PrActionState['tone'], t: ResolvedTuiTheme): string {
  if (tone === 'ok') return t.success
  if (tone === 'blocked') return t.error
  return t.textMuted
}

export const PrStateRow = memo(function PrStateRow({ projectPath }: { projectPath: string }) {
  const t = useTheme()
  // Transparent mode drops every painted background rather than punching a hole
  // in whatever the terminal is showing behind aimux.
  const transparent = useTransparent()
  const bg = transparent ? undefined : t.backgroundElement
  const result = usePrStatusStore((s) => s.result)
  const currentProjectId = useAppStore((s) => s.currentProjectId)
  const projects = useAppStore((s) => s.projects)
  const [confirming, setConfirming] = useState(false)
  const [merging, setMerging] = useState(false)
  const spinner = useBusySpinner(merging)

  const pr = result?.kind === 'ok' ? result.pr : null
  const status = result?.kind === 'ok' ? prActionState(result.pr, result.checks) : null
  const prUrl = pr?.url ?? ''

  // The PR is polled against the active workspace's path, so its branch is this
  // workspace's branch — which is what makes offering the removal here honest.
  const project = projects.find((entry) => entry.id === currentProjectId)
  const workspace = getActiveWorkspace(project)
  const projectId = project?.id ?? null
  // The repo checkout itself has no worktree to drop, so it gets no button.
  const removableWorkspaceId =
    workspace !== undefined && workspace.source !== 'primary' ? workspace.id : null

  const openPr = useCallback(() => openUrl(prUrl), [prUrl])
  const askConfirm = useCallback(() => setConfirming(true), [])
  const cancel = useCallback(() => setConfirming(false), [])
  const action = status?.action ?? null
  const confirm = useCallback(() => {
    setConfirming(false)
    if (action === 'cleanup') {
      if (projectId === null || removableWorkspaceId === null) return
      // closeTabs (not force) mirrors the sidebar's "Remove workspace": the
      // workspace's tabs are disposed, but a dirty worktree still re-prompts for
      // an explicit force-delete instead of silently discarding work.
      runSideEffectGlobal({
        closeTabs: true,
        projectId,
        type: 'delete-workspace',
        workspaceId: removableWorkspaceId,
      })
      return
    }
    setMerging(true)
    void (async () => {
      const merged = await approveAndMergePr(projectPath)
      setMerging(false)
      if (merged.ok) toast.success('Pull request merged')
      else toast.error(merged.message)
      await refreshPrStatus(projectPath)
    })()
  }, [action, projectId, projectPath, removableWorkspaceId])

  // Nothing known yet (or nothing to show): stay out of the layout entirely and
  // appear only once a fetch reports a PR.
  if (result?.kind !== 'ok' || pr === null || status === null) return null
  const showCleanup = status.action === 'cleanup' && removableWorkspaceId !== null
  const showAction = showCleanup || status.action === 'merge'
  let label = status.label
  if (confirming) label = showCleanup ? 'Remove this worktree?' : 'Merge this PR?'
  if (merging) label = `${spinner} merging…`

  return (
    <box flexDirection="row" gap={1} backgroundColor={bg} paddingLeft={1} paddingRight={1}>
      <box flexDirection="row" flexShrink={0} gap={1} onMouseDown={openPr}>
        <text selectable={false} fg={t.textMuted} bg={bg} wrapMode="none">
          #{pr.number}
        </text>
        <text selectable={false} fg={t.primary} bg={bg} wrapMode="none">
          ↗
        </text>
      </box>
      <box flexGrow={1} flexShrink={1} overflow="hidden">
        <text
          selectable={false}
          fg={merging || confirming ? t.warning : toneColor(status.tone, t)}
          bg={bg}
          wrapMode="none"
        >
          {label}
        </text>
      </box>
      {confirming ? (
        <box flexDirection="row" flexShrink={0} gap={1}>
          <text selectable={false} fg={t.success} bg={bg} wrapMode="none" onMouseDown={confirm}>
            <strong>yes</strong>
          </text>
          <text selectable={false} fg={t.textMuted} bg={bg} wrapMode="none" onMouseDown={cancel}>
            no
          </text>
        </box>
      ) : null}
      {showAction && !confirming && !merging ? (
        <box flexShrink={0}>
          <text selectable={false} fg={t.primary} bg={bg} wrapMode="none" onMouseDown={askConfirm}>
            <strong>{showCleanup ? 'Clean up' : 'Merge'}</strong>
          </text>
        </box>
      ) : null}
    </box>
  )
})
