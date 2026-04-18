import type { SnippetRecord } from '../../state/types'

import { filterSnippets } from '../../state/selectors'
import { theme } from '../theme'
import { uiTokens } from '../ui-tokens'
import { ListItem } from './list-item'
import { ModalFilterBar } from './modal-filter-bar'
import { ModalShell } from './modal-shell'

interface SnippetPickerModalProps {
  snippets: SnippetRecord[]
  selectedIndex: number
  filter: string | null
}

const MAX_PREVIEW_LENGTH = 60

function truncateContent(content: string): string {
  const normalized = content.replaceAll(/\s+/g, ' ').trim()
  if (normalized.length <= MAX_PREVIEW_LENGTH) return normalized
  return `${normalized.slice(0, MAX_PREVIEW_LENGTH - 3)}...`
}

export function SnippetPickerModal({ filter, selectedIndex, snippets }: SnippetPickerModalProps) {
  const filtered = filterSnippets(snippets, filter)

  return (
    <ModalShell
      title="Snippets"
      keybindsModeId="modal.snippet-picker"
      width={uiTokens.modalWidth.xl}
      footer={<ModalFilterBar filter={filter} />}
    >
      {filtered.length === 0 ? (
        <text fg={theme.colors['descriptionForeground']}>
          {filter ? 'No matching snippets.' : 'No snippets yet. Press n to create one.'}
        </text>
      ) : null}
      {filtered.map((snippet, index) => {
        const active = index === selectedIndex
        return (
          <ListItem
            key={snippet.id}
            active={active}
            title={
              <text
                fg={
                  active ? theme.colors['editor.foreground'] : theme.colors['descriptionForeground']
                }
              >
                <strong>{snippet.name}</strong>
              </text>
            }
            subtitle={
              <text fg={theme.colors['descriptionForeground']}>
                {truncateContent(snippet.content)}
              </text>
            }
          />
        )
      })}
    </ModalShell>
  )
}
