import { useCallback, useMemo } from 'react'

import type { WorkspaceRecord } from '../../../../state/types'

import { dispatchGlobal } from '../../../../state/dispatch-ref'
import { buildBaseRefOptions } from '../../../../state/selectors'
import { useSelectionInk } from '../../../selection-ink'
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
  const ink = useSelectionInk()

  const handleHover = useCallback(
    (index: number) => dispatchGlobal({ index, type: 'set-modal-selection-index' }),
    []
  )

  const baseItems = useMemo<FormOptionItem[]>(
    () =>
      buildBaseRefOptions(workspaces, baseBranches, baseQuery).map((option) => ({
        key: option.ref,
        leading: (active) => {
          let fg = t.textMuted
          if (active) fg = ink
          else if (option.kind === 'workspace') fg = t.warning
          return <text fg={fg}>{option.kind === 'workspace' ? '\u{e728}' : '\u{e702}'}</text>
        },
        subtitle:
          option.kind === 'workspace'
            ? (active) => <text fg={active ? ink : t.textMuted}>workspace: {option.detail}</text>
            : null,
        title: (active) => <text fg={active ? ink : t.textMuted}>{option.label}</text>,
      })),
    [baseBranches, baseQuery, ink, t, workspaces]
  )

  const baseActive = activeField === 'base'
  return (
    // The title asks the question and the subtitle answers what happens with the
    // answer, so the prompt field needs no label of its own — a heading, a
    // question, a paragraph and a placeholder all saying the same thing was four
    // lines of chrome above an empty box.
    <Form
      title="New workspace"
      subtitle="What do you want to work on? Names the workspace and its branch, and is sent to the assistant."
      keybindsModeId="modal.create-workspace"
      width={uiTokens.modalWidth.xl}
    >
      <box flexDirection="column" gap={1}>
        <box flexDirection="column">
          <TextField
            active={activeField === 'prompt'}
            value={prompt}
            cursorPos={activeField === 'prompt' ? cursorPos : undefined}
            placeholder="Describe the task, or leave empty for a bare workspace..."
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
      </box>
    </Form>
  )
}
