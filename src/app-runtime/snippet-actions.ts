import type { SessionBackend } from '../session-backend/types'
import type { AppAction, AppState, SnippetRecord, TabSession } from '../state/types'

import { createPrefixedId } from '../platform/id'
import { isConfigSnippetId, saveSnippetCatalog } from '../state/snippet-catalog'
import { writePasteToTab } from './pty-write'

function createSnippetId(): string {
  return createPrefixedId('snip')
}

export interface SnippetEditorValue {
  name: string
  trigger: string
  content: string
}

export function getSnippetEditorValue(state: AppState): SnippetEditorValue | null {
  if (state.modal.type !== 'snippet-editor') {
    return null
  }

  const { modal } = state
  const editValue = (modal.editBuffer ?? '').trim()
  const name = modal.activeField === 'name' ? editValue : modal.nameBuffer.trim()
  const trigger = modal.activeField === 'trigger' ? editValue : modal.triggerBuffer.trim()
  const content = modal.activeField === 'content' ? editValue : modal.contentBuffer.trim()

  return { content, name, trigger }
}

export function saveSnippetEditorState(state: AppState): SnippetRecord[] | null {
  const editorValue = getSnippetEditorValue(state)
  if (
    !editorValue ||
    !editorValue.name ||
    !editorValue.content ||
    state.modal.type !== 'snippet-editor'
  ) {
    return null
  }

  const snippetId = state.modal.sessionTargetId
  // Config-pinned snippets are sticky and read-only in the UI.
  if (snippetId != null && snippetId !== '' && isConfigSnippetId(snippetId)) {
    return null
  }

  const trigger = editorValue.trigger.length > 0 ? editorValue.trigger : undefined

  if (snippetId != null && snippetId !== '') {
    return state.snippets.map((snippet) =>
      snippet.id === snippetId
        ? { ...snippet, content: editorValue.content, name: editorValue.name, trigger }
        : snippet
    )
  }

  return [
    ...state.snippets,
    { content: editorValue.content, id: createSnippetId(), name: editorValue.name, trigger },
  ]
}

export function deleteSnippetState(snippets: SnippetRecord[], snippetId: string): SnippetRecord[] {
  if (isConfigSnippetId(snippetId)) return snippets
  return snippets.filter((snippet) => snippet.id !== snippetId)
}

export function pasteSnippetToTab(
  backend: SessionBackend,
  activeTabId: string | null,
  activeTab: TabSession | undefined,
  snippet: SnippetRecord | undefined
): void {
  if (!snippet || activeTabId == null || activeTabId === '' || !activeTab) {
    return
  }

  writePasteToTab(backend, activeTabId, activeTab, snippet.content)
}

export function handleDeleteSnippetEffect(
  snippets: SnippetRecord[],
  dispatch: (action: AppAction) => void,
  snippetId: string
): void {
  const updated = deleteSnippetState(snippets, snippetId)
  saveSnippetCatalog(updated)
  dispatch({ snippetId, type: 'delete-snippet' })
}

export function handleSaveSnippetEditorEffect(
  state: AppState,
  dispatch: (action: AppAction) => void
): void {
  const updated = saveSnippetEditorState(state)
  if (!updated) {
    return
  }

  saveSnippetCatalog(updated)
  dispatch({ snippets: updated, type: 'set-snippets' })
}

// Client-authoritative variant used by the GUI snippet-editor pilot (roadmap
// P1.3). The TUI's `handleSaveSnippetEditorEffect` reads buffers from
// `state.modal`; the GUI carries the committed values in the intent payload
// instead, so the in-flight UI state never has to round-trip through the
// host. Trim/validation rules mirror `getSnippetEditorValue` +
// `saveSnippetEditorState`: empty name or empty content → no-op (matches the
// TUI's silent-skip semantics, see `saveSnippetEditorState` guards).
// Config-pinned snippets stay read-only.
export function applySnippetSubmit(
  payload: { name: string; trigger: string; content: string; snippetId?: string },
  state: AppState,
  dispatch: (action: AppAction) => void
): void {
  const name = payload.name.trim()
  const content = payload.content.trim()
  const trimmedTrigger = payload.trigger.trim()
  if (name === '' || content === '') return

  const snippetId = payload.snippetId
  if (snippetId !== undefined && snippetId !== '' && isConfigSnippetId(snippetId)) return

  const trigger = trimmedTrigger.length > 0 ? trimmedTrigger : undefined

  const updated: SnippetRecord[] =
    snippetId !== undefined && snippetId !== ''
      ? state.snippets.map((snippet) =>
          snippet.id === snippetId ? { ...snippet, content, name, trigger } : snippet
        )
      : [...state.snippets, { content, id: createSnippetId(), name, trigger }]

  saveSnippetCatalog(updated)
  dispatch({ snippets: updated, type: 'set-snippets' })
}
