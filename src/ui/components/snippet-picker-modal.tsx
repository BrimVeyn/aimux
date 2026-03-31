import type { SnippetRecord } from '../../state/types'

import { theme } from '../theme'

interface SnippetPickerModalProps {
  snippets: SnippetRecord[]
  selectedIndex: number
  filter: string | null
}

function filterSnippets(snippets: SnippetRecord[], filter: string | null): SnippetRecord[] {
  if (!filter) return snippets
  const lower = filter.toLowerCase()
  return snippets.filter(
    (s) => s.name.toLowerCase().includes(lower) || s.content.toLowerCase().includes(lower)
  )
}

const MAX_PREVIEW_LENGTH = 60

function truncateContent(content: string): string {
  if (content.length <= MAX_PREVIEW_LENGTH) return content
  return `${content.slice(0, MAX_PREVIEW_LENGTH - 3)}...`
}

export function SnippetPickerModal({ snippets, selectedIndex, filter }: SnippetPickerModalProps) {
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
        padding={1}
        backgroundColor={theme.panel}
        flexDirection="column"
        gap={1}
      >
        <text fg={theme.accent}>Snippets</text>
        <text fg={theme.textMuted}>
          j/k move, Enter send, n new, e edit, d delete, / filter, Esc cancel.
        </text>
        {filter !== null ? (
          <box
            border
            borderColor={theme.borderActive}
            backgroundColor={theme.panelMuted}
            padding={1}
          >
            <text fg={theme.text}>/{filter}_</text>
          </box>
        ) : null}
        {filtered.length === 0 ? (
          <box padding={1}>
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
              padding={1}
              flexDirection="column"
            >
              <text fg={active ? theme.text : theme.textMuted}>
                {active ? '>' : ' '} {snippet.name}
              </text>
              <text fg={theme.textMuted}> {truncateContent(snippet.content)}</text>
            </box>
          )
        })}
      </box>
    </box>
  )
}
