import { memo, useCallback, useState } from 'react'

import { enqueueGitOp } from '../../../../git/command-queue'
import { approveAndMergePr } from '../../../../git/pr-merge'
import { type PrActionState, prActionState, prCleanupKind } from '../../../../git/pr-status'
import { refreshPrStatus } from '../../../../git/pr-status-poller'
import { checkoutBranch } from '../../../../git/worktree'
import { openUrl } from '../../../../platform/open-url'
import { useAppStore } from '../../../../state/app-store'
import { runSideEffectGlobal } from '../../../../state/dispatch-ref'
import { usePrStatusStore } from '../../../../state/pr-status-store'
import { toast } from '../../../../state/toast-store'
import { getActiveWorkspace } from '../../../../state/workspace-view'
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
  const removableWorkspaceId =
    workspace !== undefined && workspace.source !== 'primary' ? workspace.id : null

  const base = pr?.base ?? ''
  const cleanupKind =
    pr === null ? null : prCleanupKind(status?.action ?? null, pr, removableWorkspaceId !== null)

  const openPr = useCallback(() => openUrl(prUrl), [prUrl])
  const askConfirm = useCallback(() => setConfirming(true), [])
  const cancel = useCallback(() => setConfirming(false), [])
  const confirm = useCallback(() => {
    setConfirming(false)
    if (cleanupKind === 'worktree') {
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
    if (cleanupKind === 'branch') {
      void (async () => {
        try {
          // Queued like every other mutating git op: the pollers read this same
          // checkout, and a checkout mid-status is how you get a torn panel.
          await enqueueGitOp(async () => checkoutBranch(projectPath, base))
        } catch (error) {
          toast.error(error instanceof Error ? error.message : String(error))
          return
        }
        // The branch poller would catch up within its tick; refreshing here
        // retires the row now instead of leaving a merged PR sitting on screen.
        await refreshPrStatus(projectPath)
      })()
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
  }, [base, cleanupKind, projectId, projectPath, removableWorkspaceId])

  // Nothing known yet (or nothing to show): stay out of the layout entirely and
  // appear only once a fetch reports a PR.
  if (result?.kind !== 'ok' || pr === null || status === null) return null
  const showAction = cleanupKind !== null || status.action === 'merge'
  let label = status.label
  if (confirming) {
    if (cleanupKind === 'worktree') label = 'Remove this worktree?'
    else if (cleanupKind === 'branch') label = `Switch to ${base}?`
    else label = 'Merge this PR?'
  }
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
            <strong>{cleanupKind === null ? 'Merge' : 'Clean up'}</strong>
          </text>
        </box>
      ) : null}
    </box>
  )
})
