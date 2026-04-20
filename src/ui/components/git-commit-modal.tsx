import { useEffect, useState } from 'react'

import type { ModeId } from '../../input/modes/types'

import { useAppStore } from '../../state/app-store'
import { dispatchGlobal, runSideEffectGlobal } from '../../state/dispatch-ref'
import { useTokens } from '../theme'
import { uiTokens } from '../ui-tokens'
import { InputField } from './input-field'
import { ModalShell } from './modal-shell'

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

const AUTO_COMMIT_LABEL = 'Auto-commit'
// label + padding (1+1) + border (1+1)
const BUTTON_WIDTH = AUTO_COMMIT_LABEL.length + 2 + 2
// one content row + border (1+1)
const BUTTON_HEIGHT = 3

function buildPerimeter(w: number, h: number): ReadonlyArray<{ x: number; y: number }> {
  const cells: { x: number; y: number }[] = []
  for (let x = 0; x < w; x++) cells.push({ x, y: 0 })
  for (let y = 1; y < h; y++) cells.push({ x: w - 1, y })
  for (let x = w - 2; x >= 0; x--) cells.push({ x, y: h - 1 })
  for (let y = h - 2; y >= 1; y--) cells.push({ x: 0, y })
  return cells
}

const BUTTON_PERIMETER = buildPerimeter(BUTTON_WIDTH, BUTTON_HEIGHT)
const MARCHING_ANTS_INTERVAL_MS = 100

function useMarchingAntsIndex(active: boolean, length: number): number {
  const [index, setIndex] = useState(0)
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setIndex((i) => (i + 1) % length), MARCHING_ANTS_INTERVAL_MS)
    return () => clearInterval(id)
  }, [active, length])
  return index % length
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
  const t = useTokens()
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
      <text fg={t.palette.primary}>🪄</text>
      <box marginTop={1} flexDirection="row" gap={1}>
        <text fg={t.palette.primary}>{frame}</text>
        <text fg={t.palette.ink}>Generating commit message</text>
      </box>
      <text fg={t.muted}>via {providerLabel}</text>
      <box marginTop={1}>
        <text fg={t.muted}>Esc to cancel</text>
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
  const t = useTokens()
  const titleActive = activeField === 'title'
  const bodyActive = activeField === 'body'
  const isConfirm = stage === 'confirm'
  const isGenerating = stage === 'generating'
  const currentSessionId = useAppStore((s) => s.currentSessionId)
  const isBgGenerating = useAppStore((s) => {
    const id = s.currentSessionId
    return id ? s.autoCommit.bySession[id]?.kind === 'generating' : false
  })
  const antsActive = isBgGenerating && !isConfirm && !isGenerating
  const antsIndex = useMarchingAntsIndex(antsActive, BUTTON_PERIMETER.length)
  const antsPos = BUTTON_PERIMETER[antsIndex] ?? { x: 0, y: 0 }

  const onAutoCommitClick = (): void => {
    const hasTitle = title.trim().length > 0
    if (hasTitle || !currentSessionId) {
      dispatchGlobal({ type: 'git-commit-enter-confirm' })
      return
    }
    dispatchGlobal({ sessionId: currentSessionId, type: 'git-commit-enter-generating' })
    runSideEffectGlobal({ sessionId: currentSessionId, type: 'generate-auto-commit-now' })
  }

  const modeId = pickModeId(stage)
  const shellTitle = pickShellTitle(stage)

  return (
    <ModalShell title={shellTitle} keybindsModeId={modeId} width={uiTokens.modalWidth.xl}>
      {isGenerating ? <GeneratingOverlay assistant={assistant} model={model} /> : null}

      {isConfirm ? (
        <box flexDirection="column">
          <text fg={t.palette.warning}>
            <strong>git add -A</strong> will stage every change before committing.
          </text>
          <text fg={t.muted}>Enter to confirm · Esc to cancel · edits below still apply.</text>
        </box>
      ) : null}

      {isGenerating ? null : (
        <>
          <box flexDirection="column">
            <text fg={titleActive ? t.palette.ink : t.muted}>Title</text>
            <InputField
              active={titleActive}
              cursorPos={titleActive ? cursorPos : undefined}
              value={title}
            />
          </box>

          <box flexDirection="column">
            <text fg={bodyActive ? t.palette.ink : t.muted}>Body (optional)</text>
            <InputField
              active={bodyActive}
              cursorPos={bodyActive ? cursorPos : undefined}
              value={body}
            />
          </box>
        </>
      )}

      {isConfirm || isGenerating ? null : (
        <box flexDirection="row" gap={1} marginTop={1} alignItems="center">
          <box
            border
            borderColor={t.palette.primary}
            paddingLeft={1}
            paddingRight={1}
            position="relative"
            onMouseDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
              onAutoCommitClick()
            }}
          >
            <text fg={t.palette.primary}>
              <strong>Auto-commit</strong>
            </text>
            {antsActive ? (
              <box position="absolute" top={antsPos.y} left={antsPos.x} zIndex={10}>
                <text fg={t.accent}>●</text>
              </box>
            ) : null}
          </box>
          <text fg={t.muted}>C-a · stages all changes (AI-suggests message if empty)</text>
        </box>
      )}
    </ModalShell>
  )
}
