import { useCallback, useMemo } from 'react'

import type { WorktreeTemplate } from '../../../../config'
import type { WorktreeRecord } from '../../../../state/types'

import { dispatchGlobal, runSideEffectGlobal } from '../../../../state/dispatch-ref'
import { buildBaseRefOptions } from '../../../../state/selectors'
import { useTheme } from '../../../theme'
import { uiTokens } from '../../../ui-tokens'
import { AutoComplete, Form, type FormOptionItem, TextField } from '../shared/form'
import { Picker, type PickerItem } from '../shared/picker'

interface CreateWorktreeModalProps {
  activeField: 'name' | 'branch' | 'base'
  step: 'form' | 'template'
  worktreeName: string
  branchName: string
  branchError: string | null
  baseQuery: string
  baseRef: string
  baseBranches: string[]
  cursorPos?: number
  selectedIndex: number
  worktrees: WorktreeRecord[]
  worktreeTemplates: WorktreeTemplate[]
}

export function CreateWorktreeModal({
  activeField,
  baseBranches,
  baseQuery,
  baseRef,
  branchError,
  branchName,
  cursorPos,
  selectedIndex,
  step,
  worktreeName,
  worktrees,
  worktreeTemplates,
}: CreateWorktreeModalProps) {
  const t = useTheme()

  const handleHover = useCallback(
    (index: number) => dispatchGlobal({ index, type: 'set-modal-selection-index' }),
    []
  )

  const baseItems = useMemo<FormOptionItem[]>(
    () =>
      buildBaseRefOptions(worktrees, baseBranches, baseQuery).map((option) => ({
        key: option.ref,
        leading: (
          <text fg={option.kind === 'worktree' ? t.warning : t.textMuted}>
            {option.kind === 'worktree' ? '\u{e728}' : '\u{e702}'}
          </text>
        ),
        subtitle:
          option.kind === 'worktree' ? (
            <text fg={t.textMuted}>worktree: {option.detail}</text>
          ) : null,
        title: (active) => <text fg={active ? t.text : t.textMuted}>{option.label}</text>,
      })),
    [baseBranches, baseQuery, t, worktrees]
  )

  const templateItems = useMemo<PickerItem[]>(
    () =>
      worktreeTemplates.map((template, index) => {
        const active = index === selectedIndex
        const tabCount = template.tabs.length
        const paneCount = template.tabs.reduce((sum, tab) => sum + tab.panes.length, 0)
        return {
          key: template.id,
          onClick: () => {
            dispatchGlobal({ index, type: 'set-modal-selection-index' })
            runSideEffectGlobal({ type: 'create-worktree' })
          },
          subtitle:
            template.description != null && template.description !== '' ? (
              <text fg={t.textMuted}>{template.description}</text>
            ) : (
              <text fg={t.textMuted}>
                {tabCount} tab{tabCount === 1 ? '' : 's'}, {paneCount} pane
                {paneCount === 1 ? '' : 's'}
              </text>
            ),
          title: <text fg={active ? t.text : t.textMuted}>{template.name}</text>,
        }
      }),
    [selectedIndex, t, worktreeTemplates]
  )

  if (step === 'template') {
    return (
      <Picker
        title="New project: pick template"
        keybindsModeId="modal.create-worktree"
        width={uiTokens.modalWidth.md}
        gap={1}
        filter={null}
        items={templateItems}
        selectedIndex={selectedIndex}
        emptyState={<text fg={t.textMuted}>No templates configured.</text>}
        onHover={handleHover}
        footer={<text fg={t.textMuted}>Enter creates, Esc returns to the form</text>}
      />
    )
  }

  const baseActive = activeField === 'base'
  return (
    <Form title="New project" keybindsModeId="modal.create-worktree" width={uiTokens.modalWidth.xl}>
      <box flexDirection="column" gap={1}>
        <TextField
          active={activeField === 'name'}
          label="Project name"
          value={worktreeName}
          cursorPos={activeField === 'name' ? cursorPos : undefined}
          placeholder="my-feature"
        />
        <box flexDirection="column">
          <TextField
            active={activeField === 'branch'}
            label="Branch name"
            value={branchName}
            cursorPos={activeField === 'branch' ? cursorPos : undefined}
            placeholder="aimux/my-feature"
          />
          {branchError != null && branchError !== '' ? (
            <text fg={t.error}>{branchError}</text>
          ) : null}
        </box>
        <AutoComplete
          active={baseActive}
          label="Base (fork from)"
          placeholder="branch or worktree to fork from..."
          value={baseQuery}
          displayValue={baseRef !== '' ? baseRef : 'current branch'}
          items={baseItems}
          selectedIndex={selectedIndex}
          cursorPos={baseActive ? cursorPos : undefined}
          maxVisibleRows={6}
          onHover={handleHover}
          emptyState={<text fg={t.textMuted}>No branches found</text>}
        />
        <text fg={t.textMuted}>Tab switches fields · Enter creates</text>
      </box>
    </Form>
  )
}
