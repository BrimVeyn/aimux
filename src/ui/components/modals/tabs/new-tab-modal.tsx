import { useCallback, useMemo } from 'react'

import type { AssistantId } from '../../../../state/types'

import { getAllAssistantOptions, getAssistantOption } from '../../../../pty/command-registry'
import { dispatchGlobal, runSideEffectGlobal } from '../../../../state/dispatch-ref'
import { getNewTabAssistantOptions } from '../../../../state/selectors'
import { useWorkspaceCreateProgress } from '../../../../state/workspace-create-store'
import { useBusySpinner } from '../../../hooks/use-busy-spinner'
import { useSelectionInk } from '../../../selection-ink'
import { useTheme } from '../../../theme'
import { uiTokens } from '../../../ui-tokens'
import { Form, TextField } from '../shared/form'
import { ModalShell } from '../shared/modal-shell'
import { Picker, type PickerItem } from '../shared/picker'

interface NewTabModalProps {
  selectedIndex: number
  customCommands: Record<string, string>
  filter: string | null
  cursorPos?: number
  editingCommand: AssistantId | null
  editBuffer: string
  /**
   * Chained from `<C-p>`: the prompt waiting for the picked assistant, `''` when
   * the workspace was created without one, `null` when this is a plain new tab.
   * A shell cannot take a prompt, so Terminal is hidden only when there is one.
   */
  pendingPrompt: string | null
  /** An assistant was picked and waits for the `<C-p>` worktree to land. */
  launching: boolean
}

export function NewTabModal({
  cursorPos,
  customCommands,
  editBuffer,
  editingCommand,
  filter,
  launching,
  pendingPrompt,
  selectedIndex,
}: NewTabModalProps) {
  const t = useTheme()
  const ink = useSelectionInk()
  const spinner = useBusySpinner(launching)
  const progress = useWorkspaceCreateProgress()
  const excludeTerminal = pendingPrompt != null && pendingPrompt.trim() !== ''
  const footerText =
    pendingPrompt == null
      ? 'Enter launches in the active workspace'
      : `Enter launches in the new workspace${excludeTerminal ? ' and sends your prompt' : ''}`
  const options = useMemo(() => getAllAssistantOptions(customCommands), [customCommands])
  const filtered = useMemo(
    () => getNewTabAssistantOptions(customCommands, filter, excludeTerminal),
    [customCommands, excludeTerminal, filter]
  )

  const handleHover = useCallback(
    (index: number) => dispatchGlobal({ index, type: 'set-modal-selection-index' }),
    []
  )

  const items = useMemo<PickerItem[]>(
    () =>
      filtered.map((option, index) => {
        const active = index === selectedIndex
        const customCmd = customCommands[option.id]
        return {
          key: option.id,
          onClick: () => {
            dispatchGlobal({ index, type: 'set-modal-selection-index' })
            runSideEffectGlobal({ type: 'launch-selected-assistant' })
          },
          onEdit: () =>
            dispatchGlobal({ assistantId: option.id, type: 'open-edit-custom-command' }),
          subtitle: (
            <box flexDirection="column">
              <text fg={active ? ink : t.textMuted}>{option.description}</text>
              {customCmd != null && customCmd !== '' ? (
                <text fg={active ? ink : t.primary}>{customCmd}</text>
              ) : null}
            </box>
          ),
          title: <text fg={active ? ink : t.textMuted}>{option.label}</text>,
        }
      }),
    [customCommands, filtered, ink, selectedIndex, t]
  )

  if (launching) {
    return (
      <ModalShell
        title="New tab"
        keybindsModeId="modal.new-tab.launching"
        width={uiTokens.modalWidth.md}
        footer={<text fg={t.textMuted}>The tab opens as soon as it is ready</text>}
      >
        {progress.steps.length === 0 ? (
          <text fg={t.warning}>{spinner} Preparing…</text>
        ) : (
          progress.steps.map((step, index) => {
            if (index < progress.done) {
              return (
                <text key={step} fg={t.success}>
                  ✓ {step}
                </text>
              )
            }
            if (index === progress.done) {
              return (
                <text key={step} fg={t.warning}>
                  {spinner} {step}
                </text>
              )
            }
            return (
              <text key={step} fg={t.textMuted}>
                {`  ${step}`}
              </text>
            )
          })
        )}
      </ModalShell>
    )
  }

  if (editingCommand !== null) {
    const option = options.find((o) => o.id === editingCommand) ?? getAssistantOption(0)
    return (
      <Form
        title={`Edit command — ${option.label}`}
        keybindsModeId="modal.new-tab.editing-command"
        width={uiTokens.modalWidth.md}
      >
        {/* No description: the placeholder is the default command, so the field
            already shows what leaving it blank gets you. */}
        <TextField active value={editBuffer} cursorPos={cursorPos} placeholder={option.command} />
      </Form>
    )
  }

  return (
    <Picker
      title="New tab"
      keybindsModeId="modal.new-tab.command-edit"
      width={uiTokens.modalWidth.md}
      gap={1}
      filter={filter}
      cursorPos={cursorPos}
      items={items}
      selectedIndex={selectedIndex}
      emptyState={<text fg={t.textMuted}>No matching assistants.</text>}
      onHover={handleHover}
      footer={<text fg={t.textMuted}>{footerText}</text>}
    />
  )
}
