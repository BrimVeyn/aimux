import type { SnippetRecord } from '../../../../state/types'

import { dispatchGlobal, runSideEffectGlobal } from '../../../../state/dispatch-ref'
import { filterSnippets } from '../../../../state/selectors'
import { useTheme } from '../../../theme'
import { uiTokens } from '../../../ui-tokens'
import { Picker, type PickerItem } from '../shared/picker'

interface SnippetPickerModalProps {
  snippets: SnippetRecord[]
  selectedIndex: number
  filter: string | null
  cursorPos?: number
}

const MAX_PREVIEW_LENGTH = 60

function truncateContent(content: string): string {
  const normalized = content.replaceAll(/\s+/g, ' ').trim()
  if (normalized.length <= MAX_PREVIEW_LENGTH) return normalized
  return `${normalized.slice(0, MAX_PREVIEW_LENGTH - 3)}...`
}

export function SnippetPickerModal({
  cursorPos,
  filter,
  selectedIndex,
  snippets,
}: SnippetPickerModalProps) {
  const t = useTheme()
  const filtered = filterSnippets(snippets, filter)

  const items: PickerItem[] = filtered.map((snippet, index) => {
    const active = index === selectedIndex
    return {
      key: snippet.id,
      onClick: () => {
        dispatchGlobal({ type: 'close-modal' })
        runSideEffectGlobal({ type: 'paste-selected-snippet' })
      },
      onDelete: () => runSideEffectGlobal({ type: 'delete-selected-snippet' }),
      onEdit: () => runSideEffectGlobal({ type: 'edit-selected-snippet' }),
      subtitle: <text fg={t['text-weak']}>{truncateContent(snippet.content)}</text>,
      title: (
        <text fg={active ? t['text-base'] : t['text-weak']}>
          <strong>{snippet.name}</strong>
        </text>
      ),
    }
  })

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
        <text fg={t['text-weak']}>
          {filter ? 'No matching snippets.' : 'No snippets yet. Press n to create one.'}
        </text>
      }
      onHover={(index) => dispatchGlobal({ index, type: 'set-modal-selection-index' })}
    />
  )
}
