import type { SessionBackend } from '../session-backend/types'
import type { AppAction, AppState, SnippetRecord, TabSession } from '../state/types'

import { createPrefixedId } from '../platform/id'
import { saveSnippetCatalog } from '../state/snippet-catalog'
import { writePasteToTab } from './pty-write'

function createSnippetId(): string {
  return createPrefixedId('snip')
}

export function getSnippetEditorValue(state: AppState): { name: string; content: string } | null {
  if (state.modal.type !== 'snippet-editor') {
    return null
  }

  const { modal } = state
  const name =
    modal.activeField === 'name' ? (modal.editBuffer ?? '').trim() : modal.contentBuffer.trim()
  const content =
    modal.activeField === 'content' ? (modal.editBuffer ?? '').trim() : modal.contentBuffer.trim()

  return { content, name }
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
  if (snippetId) {
    return state.snippets.map((snippet) =>
      snippet.id === snippetId
        ? { ...snippet, content: editorValue.content, name: editorValue.name }
        : snippet
    )
  }

  return [
    ...state.snippets,
    { content: editorValue.content, id: createSnippetId(), name: editorValue.name },
  ]
}

export function deleteSnippetState(snippets: SnippetRecord[], snippetId: string): SnippetRecord[] {
  return snippets.filter((snippet) => snippet.id !== snippetId)
}

export function pasteSnippetToTab(
  backend: SessionBackend,
  activeTabId: string | null,
  activeTab: TabSession | undefined,
  snippet: SnippetRecord | undefined,
  dispatch?: (action: AppAction) => void
): void {
  if (!snippet || !activeTabId || !activeTab) {
    return
  }

  writePasteToTab(backend, activeTabId, activeTab, snippet.content, dispatch)
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
