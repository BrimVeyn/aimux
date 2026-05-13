import type { AssistantId, ScriptFileResult, WorktreeRecord } from '../../../../state/types'

import { getAllAssistantOptions, getAssistantOption } from '../../../../pty/command-registry'
import { dispatchGlobal, runSideEffectGlobal } from '../../../../state/dispatch-ref'
import { filterAssistants } from '../../../../state/selectors'
import { useTheme } from '../../../theme'
import { uiTokens } from '../../../ui-tokens'
import { AutoComplete, Form, type FormOptionItem, TextField } from '../shared/form'
import { ModalErrorPanel } from '../shared/modal-shell'
import { Picker, type PickerItem } from '../shared/picker'

interface NewTabModalProps {
  selectedIndex: number
  customCommands: Record<string, string>
  filter: string | null
  cursorPos?: number
  currentSessionId: string | null
  editingCommand: AssistantId | null
  editBuffer: string
  activeField:
    | 'assistant'
    | 'branch-name'
    | 'sanitize-script'
    | 'setup-script'
    | 'target-worktree'
    | 'worktree-name'
  branchError: string | null
  branchName: string
  createWorktree: boolean
  sanitizeScript: string
  scriptResults: ScriptFileResult[]
  selectedAssistantId: AssistantId | null
  setupScript: string
  step: 'assistant' | 'worktree' | 'worktree-create'
  worktreeDeleteConfirmId: string | null
  worktreeDeleteMessage: string | null
  worktrees: WorktreeRecord[]
  worktreeName: string
}

function getDeleteBlockedReason({
  currentSessionId,
  worktree,
  worktrees,
}: {
  currentSessionId: string | null
  worktree: WorktreeRecord | undefined
  worktrees: WorktreeRecord[]
}): string | null {
  if (!worktree) return null
  if (!currentSessionId) return 'Cannot delete: no active session.'
  if (worktrees.length <= 1) return 'Cannot delete: at least one worktree must remain.'
  if (worktree.source === 'primary') return 'Cannot delete: root worktree is required.'
  if (worktree.source === 'aimux-temp' && !worktree.createdByAimux) {
    return 'Cannot delete: this temp worktree was not created by Aimux.'
  }
  return null
}

export function NewTabModal({
  activeField,
  branchError,
  branchName,
  createWorktree,
  currentSessionId,
  cursorPos,
  customCommands,
  editBuffer,
  editingCommand,
  filter,
  sanitizeScript,
  scriptResults,
  selectedAssistantId,
  selectedIndex,
  setupScript,
  step,
  worktreeDeleteConfirmId,
  worktreeDeleteMessage,
  worktreeName,
  worktrees,
}: NewTabModalProps) {
  const t = useTheme()

  if (editingCommand !== null) {
    const option =
      getAllAssistantOptions(customCommands).find((o) => o.id === editingCommand) ??
      getAssistantOption(0)
    return (
      <Form
        title={`Edit command — ${option.label}`}
        keybindsModeId="modal.new-tab.editing-command"
        width={uiTokens.modalWidth.md}
      >
        <TextField
          active
          description={<>blank to reset to default: {option.command}</>}
          value={editBuffer}
          cursorPos={cursorPos}
          placeholder={option.command}
        />
      </Form>
    )
  }

  const options = getAllAssistantOptions(customCommands)
  const filtered = filterAssistants(options, filter)

  if (step === 'worktree-create') {
    const selectedAssistant =
      options.find((option) => option.id === selectedAssistantId) ?? options[0]
    const items: FormOptionItem[] = scriptResults.map((result) => ({
      key: result.path,
      onClick: () => dispatchGlobal({ type: 'select-script-file' }),
      title: <text fg={t.text}>{result.path}</text>,
    }))
    return (
      <Form
        title={`New worktree: ${selectedAssistant?.label ?? 'assistant'}`}
        keybindsModeId="modal.new-tab.command-edit"
        width={uiTokens.modalWidth.xl}
        sidePanel={branchError ? <ModalErrorPanel>{branchError}</ModalErrorPanel> : undefined}
      >
        <box flexDirection="column" gap={1}>
          <TextField
            active={activeField === 'worktree-name'}
            label="Worktree name"
            value={worktreeName}
            cursorPos={activeField === 'worktree-name' ? cursorPos : undefined}
            placeholder="my-feature"
          />
          <TextField
            active={activeField === 'branch-name'}
            label="Branch name"
            value={branchName}
            cursorPos={activeField === 'branch-name' ? cursorPos : undefined}
            placeholder="aimux/my-feature"
          />
          <AutoComplete
            active={activeField === 'sanitize-script'}
            cursorPos={activeField === 'sanitize-script' ? cursorPos : undefined}
            items={activeField === 'sanitize-script' ? items : []}
            label="Sanitize script"
            selectedIndex={selectedIndex}
            value={sanitizeScript}
            placeholder="./scripts/sanitize.sh"
            emptyState={<text fg={t.textMuted}>Type to search repo files.</text>}
            onHover={(index) => dispatchGlobal({ index, type: 'set-modal-selection-index' })}
          />
          <AutoComplete
            active={activeField === 'setup-script'}
            cursorPos={activeField === 'setup-script' ? cursorPos : undefined}
            items={activeField === 'setup-script' ? items : []}
            label="Setup script"
            selectedIndex={selectedIndex}
            value={setupScript}
            placeholder="./scripts/setup.sh"
            emptyState={<text fg={t.textMuted}>Type to search repo files.</text>}
            onHover={(index) => dispatchGlobal({ index, type: 'set-modal-selection-index' })}
          />
          <text fg={t.textMuted}>Step 3/3: configure new worktree</text>
        </box>
      </Form>
    )
  }

  if (step === 'worktree') {
    const selectedAssistant =
      options.find((option) => option.id === selectedAssistantId) ??
      filtered[selectedIndex] ??
      options[0]
    const selectedWorktree = worktrees[selectedIndex]
    const deleteBlockedReason = getDeleteBlockedReason({
      currentSessionId,
      worktree: selectedWorktree,
      worktrees,
    })
    const worktreeItems: PickerItem[] = [
      ...worktrees.map((worktree, index) => {
        const active = index === selectedIndex
        const label = worktree.branch ?? worktree.name
        const canDelete = !getDeleteBlockedReason({ currentSessionId, worktree, worktrees })
        return {
          key: worktree.id,
          onClick: () => {
            dispatchGlobal({ index, type: 'set-modal-selection-index' })
            runSideEffectGlobal({ type: 'launch-selected-assistant' })
          },
          onDelete:
            active && canDelete && currentSessionId
              ? () => {
                  dispatchGlobal({ index, type: 'set-modal-selection-index' })
                  dispatchGlobal({ message: null, type: 'set-new-tab-worktree-delete-state' })
                  runSideEffectGlobal({
                    force: worktreeDeleteConfirmId === worktree.id,
                    sessionId: currentSessionId,
                    type: 'delete-worktree',
                    worktreeId: worktree.id,
                  })
                }
              : undefined,
          subtitle: (
            <box flexDirection="column">
              <text fg={t.textMuted}>{worktree.path}</text>
              <text fg={t.textMuted}>{worktree.source}</text>
            </box>
          ),
          title: <text fg={active ? t.text : t.textMuted}>{label}</text>,
        }
      }),
      {
        key: '__create-worktree__',
        onClick: () => dispatchGlobal({ type: 'enter-new-tab-worktree-create' }),
        subtitle: <text fg={t.textMuted}>Create an Aimux temp worktree</text>,
        title: <text fg={createWorktree ? t.text : t.textMuted}>Create new worktree</text>,
      },
    ]
    const sideMessage = worktreeDeleteMessage ?? deleteBlockedReason
    return (
      <Picker
        title={`New assistant: ${selectedAssistant?.label ?? 'assistant'}`}
        keybindsModeId="modal.new-tab.command-edit"
        width={uiTokens.modalWidth.md}
        gap={1}
        filter={null}
        items={worktreeItems}
        selectedIndex={selectedIndex}
        sidePanel={
          sideMessage ? (
            <ModalErrorPanel tone={worktreeDeleteMessage ? 'error' : 'muted'}>
              {sideMessage}
            </ModalErrorPanel>
          ) : undefined
        }
        emptyState={<text fg={t.textMuted}>No worktrees.</text>}
        onHover={(index) => dispatchGlobal({ index, type: 'set-modal-selection-index' })}
        footer={
          <box flexDirection="column">
            <text fg={t.textMuted}>Step 2/2: choose worktree</text>
            <text fg={t.textMuted}>Enter launches, Ctrl+d deletes selected worktree</text>
          </box>
        }
      />
    )
  }

  const items: PickerItem[] = filtered.map((option, index) => {
    const active = index === selectedIndex
    const customCmd = customCommands[option.id]
    return {
      key: option.id,
      onClick: () => dispatchGlobal({ assistantId: option.id, type: 'select-new-tab-assistant' }),
      onEdit: () => dispatchGlobal({ assistantId: option.id, type: 'open-edit-custom-command' }),
      subtitle: (
        <box flexDirection="column">
          <text fg={t.textMuted}>{option.description}</text>
          {customCmd ? <text fg={t.primary}>{customCmd}</text> : null}
        </box>
      ),
      title: <text fg={active ? t.text : t.textMuted}>{option.label}</text>,
    }
  })

  return (
    <Picker
      title="New assistant: choose assistant"
      keybindsModeId="modal.new-tab.command-edit"
      width={uiTokens.modalWidth.md}
      gap={1}
      filter={filter}
      cursorPos={activeField === 'assistant' ? cursorPos : undefined}
      items={items}
      selectedIndex={selectedIndex}
      emptyState={<text fg={t.textMuted}>No matching assistants.</text>}
      onHover={(index) => dispatchGlobal({ index, type: 'set-modal-selection-index' })}
      footer={
        <box flexDirection="column">
          <text fg={t.textMuted}>Step 1/2: choose assistant</text>
          <text fg={t.textMuted}>Enter continues to worktree selection</text>
        </box>
      }
    />
  )
}
