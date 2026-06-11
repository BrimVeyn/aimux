import { useCallback, useMemo } from 'react'

import type { WorktreeTemplate } from '../../../../config'
import type { AssistantId, WorktreeRecord } from '../../../../state/types'

import { getAllAssistantOptions, getAssistantOption } from '../../../../pty/command-registry'
import { dispatchGlobal, runSideEffectGlobal } from '../../../../state/dispatch-ref'
import {
  buildBaseRefOptions,
  filterAssistants,
  getTemplateNoneOffset,
} from '../../../../state/selectors'
import { useTheme } from '../../../theme'
import { uiTokens } from '../../../ui-tokens'
import { AutoComplete, Form, type FormOptionItem, TextField } from '../shared/form'
import { Picker, type PickerItem } from '../shared/picker'
import { WorktreeDeleteConfirm } from '../shared/worktree-delete-confirm'

interface NewTabModalProps {
  selectedIndex: number
  customCommands: Record<string, string>
  filter: string | null
  cursorPos?: number
  currentSessionId: string | null
  editingCommand: AssistantId | null
  editBuffer: string
  activeField: 'assistant' | 'branch-name' | 'target-worktree' | 'worktree-name' | 'base'
  branchError: string | null
  branchName: string
  createWorktree: boolean
  selectedAssistantId: AssistantId | null
  step: 'assistant' | 'worktree' | 'worktree-create' | 'template'
  worktreeDeletePrompt: { worktreeId: string; reason: string } | null
  worktrees: WorktreeRecord[]
  worktreeName: string
  baseQuery: string
  baseRef: string
  baseBranches: string[]
  worktreeTemplates: WorktreeTemplate[]
  /**
   * True when this modal is the worktree-aware new-tab flow. False when the
   * component is reused for `split-picker`, which can only choose an
   * assistant — the template shortcut entry must be hidden there.
   */
  allowTemplateShortcut: boolean
}

const TEMPLATE_SHORTCUT_KEY = '__template-shortcut__'

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
  if (!(currentSessionId != null && currentSessionId !== ''))
    return 'Cannot delete: no active session.'
  if (worktrees.length <= 1) return 'Cannot delete: at least one worktree must remain.'
  if (worktree.source === 'primary') return 'Cannot delete: root worktree is required.'
  if (worktree.source === 'aimux-temp' && !worktree.createdByAimux) {
    return 'Cannot delete: this temp worktree was not created by Aimux.'
  }
  return null
}

export function NewTabModal({
  activeField,
  allowTemplateShortcut,
  baseBranches,
  baseQuery,
  baseRef,
  branchError,
  branchName,
  createWorktree,
  currentSessionId,
  cursorPos,
  customCommands,
  editBuffer,
  editingCommand,
  filter,
  selectedAssistantId,
  selectedIndex,
  step,
  worktreeDeletePrompt,
  worktreeName,
  worktrees,
  worktreeTemplates,
}: NewTabModalProps) {
  const t = useTheme()
  const options = useMemo(() => getAllAssistantOptions(customCommands), [customCommands])
  const filtered = useMemo(() => filterAssistants(options, filter), [filter, options])

  const handleHover = useCallback(
    (index: number) => dispatchGlobal({ index, type: 'set-modal-selection-index' }),
    []
  )

  const worktreeItems = useMemo<PickerItem[]>(
    () => [
      ...worktrees.map((worktree, index) => {
        const active = index === selectedIndex
        const label = worktree.branch ?? worktree.name
        const blockedReason = getDeleteBlockedReason({ currentSessionId, worktree, worktrees })
        const canDelete = blockedReason == null || blockedReason === ''
        return {
          key: worktree.id,
          onClick: () => {
            dispatchGlobal({ index, type: 'set-modal-selection-index' })
            runSideEffectGlobal({ type: 'launch-selected-assistant' })
          },
          onDelete:
            active && canDelete && currentSessionId != null && currentSessionId !== ''
              ? () => {
                  dispatchGlobal({ index, type: 'set-modal-selection-index' })
                  runSideEffectGlobal({
                    force: false,
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
        onClick: () => {
          dispatchGlobal({ type: 'enter-new-tab-worktree-create' })
          runSideEffectGlobal({ type: 'load-new-tab-base-branches' })
        },
        subtitle: <text fg={t.textMuted}>Create an Aimux temp worktree</text>,
        title: <text fg={createWorktree ? t.text : t.textMuted}>Create new worktree</text>,
      },
    ],
    [createWorktree, currentSessionId, selectedIndex, t, worktrees]
  )

  const noneOffset = getTemplateNoneOffset(selectedAssistantId)
  const showNoneOption = noneOffset === 1
  const templateItems = useMemo<PickerItem[]>(() => {
    const noneItem: PickerItem[] = showNoneOption
      ? [
          {
            key: '__none__',
            onClick: () => {
              dispatchGlobal({ index: 0, type: 'set-modal-selection-index' })
              runSideEffectGlobal({ type: 'launch-selected-assistant' })
            },
            subtitle: <text fg={t.textMuted}>Single pane — current assistant only</text>,
            title: <text fg={selectedIndex === 0 ? t.text : t.textMuted}>None</text>,
          },
        ]
      : []
    return [
      ...noneItem,
      ...worktreeTemplates.map((template, idx) => {
        const itemIndex = idx + noneOffset
        const active = itemIndex === selectedIndex
        const tabCount = template.tabs.length
        const paneCount = template.tabs.reduce((sum, tab) => sum + tab.panes.length, 0)
        return {
          key: template.id,
          onClick: () => {
            dispatchGlobal({ index: itemIndex, type: 'set-modal-selection-index' })
            runSideEffectGlobal({ type: 'launch-selected-assistant' })
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
    ]
  }, [noneOffset, selectedIndex, showNoneOption, t, worktreeTemplates])

  const showShortcutEntry = allowTemplateShortcut && worktreeTemplates.length > 0
  const items = useMemo<PickerItem[]>(() => {
    const assistantItems: PickerItem[] = filtered.map((option, index) => {
      const active = index === selectedIndex
      const customCmd = customCommands[option.id]
      return {
        key: option.id,
        onClick: () => dispatchGlobal({ assistantId: option.id, type: 'select-new-tab-assistant' }),
        onEdit: () => dispatchGlobal({ assistantId: option.id, type: 'open-edit-custom-command' }),
        subtitle: (
          <box flexDirection="column">
            <text fg={t.textMuted}>{option.description}</text>
            {customCmd != null && customCmd !== '' ? <text fg={t.primary}>{customCmd}</text> : null}
          </box>
        ),
        title: <text fg={active ? t.text : t.textMuted}>{option.label}</text>,
      }
    })
    if (!showShortcutEntry) return assistantItems
    const shortcutIndex = filtered.length
    const shortcutActive = shortcutIndex === selectedIndex
    return [
      ...assistantItems,
      {
        key: TEMPLATE_SHORTCUT_KEY,
        onClick: () => {
          dispatchGlobal({ index: shortcutIndex, type: 'set-modal-selection-index' })
          dispatchGlobal({ type: 'enter-new-tab-template-shortcut' })
        },
        subtitle: (
          <text fg={t.textMuted}>Create a worktree and pick a template — no assistant step</text>
        ),
        title: <text fg={shortcutActive ? t.text : t.textMuted}>Worktree from template…</text>,
      },
    ]
  }, [customCommands, filtered, showShortcutEntry, selectedIndex, t])

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

  if (editingCommand !== null) {
    const option = options.find((o) => o.id === editingCommand) ?? getAssistantOption(0)
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

  if (step === 'template') {
    return (
      <Picker
        title="Pick worktree template"
        keybindsModeId="modal.new-tab.command-edit"
        width={uiTokens.modalWidth.md}
        gap={1}
        filter={null}
        items={templateItems}
        selectedIndex={selectedIndex}
        emptyState={<text fg={t.textMuted}>No templates configured.</text>}
        onHover={handleHover}
        footer={
          <box flexDirection="column">
            <text fg={t.textMuted}>Step 4/4: choose template</text>
            <text fg={t.textMuted}>Enter launches, Esc returns to worktree settings</text>
          </box>
        }
      />
    )
  }

  if (step === 'worktree-create') {
    const selectedAssistant =
      options.find((option) => option.id === selectedAssistantId) ?? options[0]
    const baseActive = activeField === 'base'
    return (
      <Form
        title={`New worktree: ${selectedAssistant?.label ?? 'assistant'}`}
        keybindsModeId="modal.new-tab.command-edit"
        width={uiTokens.modalWidth.xl}
      >
        <box flexDirection="column" gap={1}>
          <TextField
            active={activeField === 'worktree-name'}
            label="Worktree name"
            value={worktreeName}
            cursorPos={activeField === 'worktree-name' ? cursorPos : undefined}
            placeholder="my-feature"
          />
          <box flexDirection="column">
            <TextField
              active={activeField === 'branch-name'}
              label="Branch name"
              value={branchName}
              cursorPos={activeField === 'branch-name' ? cursorPos : undefined}
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
          <text fg={t.textMuted}>Step 3/3: configure new worktree · Tab switches fields</text>
        </box>
      </Form>
    )
  }

  if (step === 'worktree') {
    const selectedAssistant =
      options.find((option) => option.id === selectedAssistantId) ??
      filtered[selectedIndex] ??
      options[0]

    if (worktreeDeletePrompt != null) {
      const target = worktrees.find((worktree) => worktree.id === worktreeDeletePrompt.worktreeId)
      const label = target?.branch ?? target?.name ?? 'this worktree'
      return (
        <WorktreeDeleteConfirm
          keybindsModeId="modal.new-tab.worktree-delete-confirm"
          reason={worktreeDeletePrompt.reason}
          worktreeLabel={label}
        />
      )
    }

    const selectedWorktree = worktrees[selectedIndex]
    const deleteBlockedReason = getDeleteBlockedReason({
      currentSessionId,
      worktree: selectedWorktree,
      worktrees,
    })
    return (
      <Picker
        title={`New assistant: ${selectedAssistant?.label ?? 'assistant'}`}
        keybindsModeId="modal.new-tab.command-edit"
        width={uiTokens.modalWidth.md}
        gap={1}
        filter={null}
        items={worktreeItems}
        selectedIndex={selectedIndex}
        emptyState={<text fg={t.textMuted}>No worktrees.</text>}
        onHover={handleHover}
        footer={
          <box flexDirection="column">
            {deleteBlockedReason != null && deleteBlockedReason !== '' ? (
              <text fg={t.textMuted}>{deleteBlockedReason}</text>
            ) : null}
            <text fg={t.textMuted}>Step 2/2: choose worktree</text>
            <text fg={t.textMuted}>Enter launches, Ctrl+d deletes selected worktree</text>
          </box>
        }
      />
    )
  }

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
      onHover={handleHover}
      footer={
        <box flexDirection="column">
          <text fg={t.textMuted}>Step 1/2: choose assistant</text>
          <text fg={t.textMuted}>Enter continues to worktree selection</text>
        </box>
      }
    />
  )
}
