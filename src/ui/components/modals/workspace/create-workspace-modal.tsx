import { useCallback, useMemo } from 'react'

import type { WorkspaceTemplate } from '../../../../config'
import type { WorkspaceRecord } from '../../../../state/types'

import { dispatchGlobal, runSideEffectGlobal } from '../../../../state/dispatch-ref'
import { buildBaseRefOptions } from '../../../../state/selectors'
import { useTheme } from '../../../theme'
import { uiTokens } from '../../../ui-tokens'
import { AutoComplete, Form, type FormOptionItem, TextField } from '../shared/form'
import { Picker, type PickerItem } from '../shared/picker'

interface CreateWorkspaceModalProps {
  activeField: 'name' | 'branch' | 'base'
  step: 'form' | 'template'
  workspaceName: string
  branchName: string
  branchError: string | null
  baseQuery: string
  baseRef: string
  baseBranches: string[]
  cursorPos?: number
  selectedIndex: number
  workspaces: WorkspaceRecord[]
  workspaceTemplates: WorkspaceTemplate[]
}

export function CreateWorkspaceModal({
  activeField,
  baseBranches,
  baseQuery,
  baseRef,
  branchError,
  branchName,
  cursorPos,
  selectedIndex,
  step,
  workspaceName,
  workspaces,
  workspaceTemplates,
}: CreateWorkspaceModalProps) {
  const t = useTheme()

  const handleHover = useCallback(
    (index: number) => dispatchGlobal({ index, type: 'set-modal-selection-index' }),
    []
  )

  const baseItems = useMemo<FormOptionItem[]>(
    () =>
      buildBaseRefOptions(workspaces, baseBranches, baseQuery).map((option) => ({
        key: option.ref,
        leading: (
          <text fg={option.kind === 'workspace' ? t.warning : t.textMuted}>
            {option.kind === 'workspace' ? '\u{e728}' : '\u{e702}'}
          </text>
        ),
        subtitle:
          option.kind === 'workspace' ? (
            <text fg={t.textMuted}>workspace: {option.detail}</text>
          ) : null,
        title: (active) => <text fg={active ? t.text : t.textMuted}>{option.label}</text>,
      })),
    [baseBranches, baseQuery, t, workspaces]
  )

  const templateItems = useMemo<PickerItem[]>(
    () =>
      workspaceTemplates.map((template, index) => {
        const active = index === selectedIndex
        const tabCount = template.tabs.length
        const paneCount = template.tabs.reduce((sum, tab) => sum + tab.panes.length, 0)
        return {
          key: template.id,
          onClick: () => {
            dispatchGlobal({ index, type: 'set-modal-selection-index' })
            runSideEffectGlobal({ type: 'create-workspace' })
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
    [selectedIndex, t, workspaceTemplates]
  )

  if (step === 'template') {
    return (
      <Picker
        title="New project: pick template"
        keybindsModeId="modal.create-workspace"
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
    <Form
      title="New project"
      keybindsModeId="modal.create-workspace"
      width={uiTokens.modalWidth.xl}
    >
      <box flexDirection="column" gap={1}>
        <TextField
          active={activeField === 'name'}
          label="Project name"
          value={workspaceName}
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
          placeholder="branch or workspace to fork from..."
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
