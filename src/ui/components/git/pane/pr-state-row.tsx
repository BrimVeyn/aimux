import { memo, useCallback, useState } from 'react'

import { approveAndMergePr } from '../../../../git/pr-merge'
import { type PrActionState, prActionState } from '../../../../git/pr-status'
import { refreshPrStatus } from '../../../../git/pr-status-poller'
import { openUrl } from '../../../../platform/open-url'
import { usePrStatusStore } from '../../../../state/pr-status-store'
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
  const [confirming, setConfirming] = useState(false)
  const [merging, setMerging] = useState(false)
  const spinner = useBusySpinner(merging)

  const pr = result?.kind === 'ok' ? result.pr : null
  const prUrl = pr?.url ?? ''

  const openPr = useCallback(() => openUrl(prUrl), [prUrl])
  const askConfirm = useCallback(() => setConfirming(true), [])
  const cancel = useCallback(() => setConfirming(false), [])
  const confirm = useCallback(() => {
    setConfirming(false)
    setMerging(true)
    void (async () => {
      const merged = await approveAndMergePr(projectPath)
      setMerging(false)
      if (merged.ok) toast.success('Pull request merged')
      else toast.error(merged.message)
      await refreshPrStatus(projectPath)
    })()
  }, [projectPath])

  // First fetch still in flight: hold the band empty so the tabs below don't
  // jump a row once the PR lands.
  if (result === null) {
    return (
      <box backgroundColor={bg} paddingLeft={1} paddingRight={1}>
        <text selectable={false} bg={bg} wrapMode="none">
          {' '}
        </text>
      </box>
    )
  }
  if (result.kind !== 'ok' || pr === null) return null
  const status = prActionState(pr, result.checks)
  let label = status.label
  if (confirming) label = 'Merge this PR?'
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
      {status.action === 'merge' && !confirming && !merging ? (
        <box flexShrink={0}>
          <text selectable={false} fg={t.primary} bg={bg} wrapMode="none" onMouseDown={askConfirm}>
            <strong>Merge</strong>
          </text>
        </box>
      ) : null}
    </box>
  )
})
