import type { MouseEvent as OtuiMouseEvent } from '@opentui/core'

import { isAutoCommitEnabled } from '@brimveyn/aimux-config'
import { useCallback, useEffect, useState } from 'react'

import type { ModeId } from '../../../../input/modes/types'

import { useAppStore } from '../../../../state/app-store'
import { dispatchGlobal, runSideEffectGlobal } from '../../../../state/dispatch-ref'
import { useTheme } from '../../../theme'
import { uiTokens } from '../../../ui-tokens'
import { InputField } from '../../primitives/input-field'
import { ModalShell } from '../shared/modal-shell'

interface GitCommitModalProps {
  activeField: 'title' | 'body'
  title: string
  body: string
  cursorPos: number
  stage: 'edit' | 'generating' | 'confirm'
  assistant?: string
  model?: string
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const SPINNER_INTERVAL_MS = 80

function useSpinnerFrame(active: boolean): string {
  const [index, setIndex] = useState(0)
  useEffect(() => {
    if (!active) return
    const id = setInterval(
      () => setIndex((i) => (i + 1) % SPINNER_FRAMES.length),
      SPINNER_INTERVAL_MS
    )
    return () => clearInterval(id)
  }, [active])
  return SPINNER_FRAMES[index] ?? '⠋'
}

function pickModeId(stage: 'edit' | 'generating' | 'confirm'): ModeId {
  if (stage === 'generating') return 'modal.git-commit.generating'
  if (stage === 'confirm') return 'modal.git-commit.confirm'
  return 'modal.git-commit'
}

function pickShellTitle(stage: 'edit' | 'generating' | 'confirm'): string {
  if (stage === 'generating') return 'Auto-commit'
  if (stage === 'confirm') return 'Auto-commit (stage all + commit)'
  return 'Commit'
}

function GeneratingOverlay({ assistant, model }: { assistant?: string; model?: string }) {
  const t = useTheme()
  const frame = useSpinnerFrame(true)
  const providerLabel = [assistant, model].filter(Boolean).join(' · ') || 'configured provider'
  return (
    <box
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      paddingTop={2}
      paddingBottom={2}
    >
      <text fg={t.primary}>🪄</text>
      <box marginTop={1} flexDirection="row" gap={1}>
        <text fg={t.primary}>{frame}</text>
        <text fg={t.text}>Generating commit message</text>
      </box>
      <text fg={t.textMuted}>via {providerLabel}</text>
      <box marginTop={1}>
        <text fg={t.textMuted}>Esc to cancel</text>
      </box>
    </box>
  )
}

export function GitCommitModal({
  activeField,
  assistant,
  body,
  cursorPos,
  model,
  stage,
  title,
}: GitCommitModalProps) {
  const t = useTheme()
  const titleActive = activeField === 'title'
  const bodyActive = activeField === 'body'
  const isConfirm = stage === 'confirm'
  const isGenerating = stage === 'generating'
  const currentProjectId = useAppStore((s) => s.currentProjectId)
  const bgKind = useAppStore((s) => {
    const id = s.currentProjectId
    return id != null && id !== '' ? s.autoCommit.byProject[id]?.kind : undefined
  })
  const isBgGenerating = bgKind === 'generating'
  const showBgSpinner = isBgGenerating && !isConfirm && !isGenerating
  const bgSpinnerFrame = useSpinnerFrame(showBgSpinner)
  const stagedCount = useAppStore(
    (s) => s.gitPanel.files.filter((f) => f.section === 'staged').length
  )

  const onAutoCommitClick = useCallback((): void => {
    const hasTitle = title.trim().length > 0
    if (hasTitle || !(currentProjectId != null && currentProjectId !== '')) {
      dispatchGlobal({ type: 'git-commit-enter-confirm' })
      return
    }
    if (bgKind === 'ready') {
      dispatchGlobal({ projectId: currentProjectId, type: 'git-commit-use-background-suggestion' })
      return
    }
    dispatchGlobal({ projectId: currentProjectId, type: 'git-commit-enter-generating' })
    if (bgKind !== 'generating') {
      runSideEffectGlobal({ projectId: currentProjectId, type: 'generate-auto-commit-now' })
    }
  }, [bgKind, currentProjectId, title])

  const handleAutoCommitMouseDown = useCallback(
    (event: OtuiMouseEvent) => {
      event.preventDefault()
      event.stopPropagation()
      onAutoCommitClick()
    },
    [onAutoCommitClick]
  )

  const modeId = pickModeId(stage)
  const shellTitle = pickShellTitle(stage)

  return (
    <ModalShell title={shellTitle} keybindsModeId={modeId} width={uiTokens.modalWidth.xl}>
      {isGenerating ? <GeneratingOverlay assistant={assistant} model={model} /> : null}

      {isConfirm ? (
        <box flexDirection="column">
          {stagedCount > 0 ? (
            <text fg={t.warning}>
              Commit will include the <strong>{stagedCount} staged file(s)</strong> only.
            </text>
          ) : (
            <text fg={t.warning}>
              <strong>git add -A</strong> will stage every change before committing.
            </text>
          )}
          <text fg={t.textMuted}>Enter to confirm · Esc to cancel · edits below still apply.</text>
        </box>
      ) : null}

      {isGenerating ? null : (
        <>
          <box flexDirection="column">
            <text fg={titleActive ? t.text : t.textMuted}>Title</text>
            <InputField
              active={titleActive}
              cursorPos={titleActive ? cursorPos : undefined}
              value={title}
            />
          </box>

          <box flexDirection="column">
            <text fg={bodyActive ? t.text : t.textMuted}>Body (optional)</text>
            <InputField
              active={bodyActive}
              cursorPos={bodyActive ? cursorPos : undefined}
              value={body}
            />
          </box>
        </>
      )}

      {isConfirm || isGenerating || !isAutoCommitEnabled() ? null : (
        <box flexDirection="row" gap={1} marginTop={1} alignItems="center">
          <box
            border
            borderColor={t.border}
            paddingLeft={1}
            paddingRight={1}
            flexDirection="row"
            gap={1}
            alignItems="center"
            onMouseDown={handleAutoCommitMouseDown}
          >
            {showBgSpinner ? <text fg={t.primary}>{bgSpinnerFrame}</text> : null}
            <text fg={t.text}>
              <strong>Auto-commit</strong>
            </text>
          </box>
          <text fg={t.textMuted}>C-a · stages all changes (AI-suggests message if empty)</text>
        </box>
      )}
    </ModalShell>
  )
}
