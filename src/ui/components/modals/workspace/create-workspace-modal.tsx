import { useCallback, useMemo } from 'react'

import type { WorkspaceRecord } from '../../../../state/types'

import { dispatchGlobal } from '../../../../state/dispatch-ref'
import { buildBaseRefOptions } from '../../../../state/selectors'
import { useTheme } from '../../../theme'
import { uiTokens } from '../../../ui-tokens'
import { AutoComplete, Form, type FormOptionItem, TextField } from '../shared/form'

/** The box is this tall from the start: a one-line slot asks for a one-line task. */
const PROMPT_LINES = 5

interface CreateWorkspaceModalProps {
  activeField: 'prompt' | 'base'
  prompt: string
  branchError: string | null
  baseQuery: string
  baseRef: string
  baseBranches: string[]
  cursorPos?: number
  selectedIndex: number
  workspaces: WorkspaceRecord[]
}

export function CreateWorkspaceModal({
  activeField,
  baseBranches,
  baseQuery,
  baseRef,
  branchError,
  cursorPos,
  prompt,
  selectedIndex,
  workspaces,
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

  const baseActive = activeField === 'base'
  return (
    <Form
      title="New workspace"
      keybindsModeId="modal.create-workspace"
      width={uiTokens.modalWidth.xl}
    >
      <box flexDirection="column" gap={1}>
        <box flexDirection="column">
          <TextField
            active={activeField === 'prompt'}
            label="What do you want to work on?"
            description="Sent to the assistant, and names the workspace and its branch."
            value={prompt}
            cursorPos={activeField === 'prompt' ? cursorPos : undefined}
            placeholder="Describe the task..."
            minLines={PROMPT_LINES}
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
        <text fg={t.textMuted}>Ctrl+Enter newline · Tab picks a base · Enter creates</text>
      </box>
    </Form>
  )
}
