import { useCallback, useMemo } from 'react'

import type { SnippetRecord } from '../../../../state/types'

import { dispatchGlobal, runSideEffectGlobal } from '../../../../state/dispatch-ref'
import { filterSnippets } from '../../../../state/selectors'
import { isConfigSnippetId } from '../../../../state/snippet-catalog'
import { useTheme } from '../../../theme'
import { uiTokens } from '../../../ui-tokens'
import { Picker, type PickerItem } from '../shared/picker'

interface SnippetPickerModalProps {
  snippets: SnippetRecord[]
  selectedIndex: number
  filter: string | null
  cursorPos?: number
  actionMessage?: string | null
}

const MAX_PREVIEW_LENGTH = 60

function truncateContent(content: string): string {
  const normalized = content.replaceAll(/\s+/g, ' ').trim()
  if (normalized.length <= MAX_PREVIEW_LENGTH) return normalized
  return `${normalized.slice(0, MAX_PREVIEW_LENGTH - 3)}...`
}

export function SnippetPickerModal({
  actionMessage,
  cursorPos,
  filter,
  selectedIndex,
  snippets,
}: SnippetPickerModalProps) {
  const t = useTheme()
  const filtered = useMemo(() => filterSnippets(snippets, filter), [filter, snippets])

  const items = useMemo<PickerItem[]>(
    () =>
      filtered.map((snippet, index) => {
        const active = index === selectedIndex
        const fromConfig = isConfigSnippetId(snippet.id)
        return {
          key: snippet.id,
          onClick: () => {
            dispatchGlobal({ type: 'close-modal' })
            runSideEffectGlobal({ type: 'paste-selected-snippet' })
          },
          onDelete: fromConfig
            ? undefined
            : () => runSideEffectGlobal({ type: 'delete-selected-snippet' }),
          onEdit: fromConfig
            ? undefined
            : () => runSideEffectGlobal({ type: 'edit-selected-snippet' }),
          subtitle: <text fg={t.textMuted}>{truncateContent(snippet.content)}</text>,
          title: (
            <box flexDirection="row">
              <text fg={active ? t.text : t.textMuted}>
                <strong>{snippet.name}</strong>
              </text>
              {snippet.trigger != null && snippet.trigger !== '' ? (
                <text fg={t.textMuted}>{` :${snippet.trigger}`}</text>
              ) : null}
              {fromConfig ? <text fg={t.textMuted}>{' [config]'}</text> : null}
            </box>
          ),
        }
      }),
    [filtered, selectedIndex, t]
  )

  const handleHover = useCallback(
    (index: number) => dispatchGlobal({ index, type: 'set-modal-selection-index' }),
    []
  )

  return (
    <Picker
      title="Snippets"
      keybindsModeId="modal.snippet-picker.filtering"
      width={uiTokens.modalWidth.xl}
      gap={1}
      filter={filter}
      cursorPos={cursorPos}
      items={items}
      selectedIndex={selectedIndex}
      emptyState={
        <text fg={t.textMuted}>
          {filter != null && filter !== ''
            ? 'No matching snippets.'
            : 'No snippets yet. Press n to create one.'}
        </text>
      }
      footer={
        actionMessage != null && actionMessage !== '' ? (
          <text fg={t.error}>{actionMessage}</text>
        ) : undefined
      }
      onHover={handleHover}
    />
  )
}
