import type { SnippetRecord } from '../../state/types'

import { filterSnippets } from '../../state/selectors'
import { theme } from '../theme'
import { ModalFilterBar } from './modal-filter-bar'

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
    <box
      position="absolute"
      top={0}
      left={0}
      width="100%"
      height="100%"
      justifyContent="center"
      alignItems="center"
    >
      <box
        width="60%"
        border
        borderColor={theme.borderActive}
        backgroundColor={theme.panel}
        flexDirection="column"
        gap={0}
      >
        <box
          paddingLeft={1}
          paddingRight={1}
          paddingTop={1}
          paddingBottom={1}
          flexDirection="column"
        >
          <text fg={theme.accent}>Snippets</text>
          <text fg={theme.textMuted}>
            j/k move, Enter send, n new, e edit, d delete, / filter, Esc cancel.
          </text>
        </box>
        {filtered.length === 0 ? (
          <box paddingLeft={1} paddingRight={1} paddingTop={1} paddingBottom={1}>
            <text fg={theme.textMuted}>
              {filter ? 'No matching snippets.' : 'No snippets yet. Press n to create one.'}
            </text>
          </box>
        ) : null}
        {filtered.map((snippet, index) => {
          const active = index === selectedIndex
          return (
            <box
              key={snippet.id}
              border
              borderColor={active ? theme.borderActive : theme.border}
              backgroundColor={active ? theme.panelMuted : theme.background}
              flexDirection="column"
            >
              <text fg={active ? theme.text : theme.textMuted}>
                {active ? '> ' : '  '}
                <strong>{snippet.name}</strong>
              </text>
              <text fg={theme.textMuted}> {truncateContent(snippet.content)}</text>
            </box>
          )
        })}
        <ModalFilterBar filter={filter} />
      </box>
    </box>
  )
}
