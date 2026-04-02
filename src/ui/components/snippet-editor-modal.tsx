import { theme } from '../theme'

interface SnippetEditorModalProps {
  activeField: 'name' | 'content'
  snippetName: string
  snippetContent: string
  isEditing: boolean
}

export function SnippetEditorModal({
  activeField,
  snippetName,
  snippetContent,
  isEditing,
}: SnippetEditorModalProps) {
  const nameActive = activeField === 'name'
  const contentActive = activeField === 'content'

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
        <text fg={theme.accent}>{isEditing ? 'Edit snippet' : 'Create snippet'}</text>
        <text fg={theme.textMuted}>Tab switch field. Enter on content to save. Esc cancel.</text>

        <text fg={nameActive ? theme.text : theme.textMuted}>Name:</text>
        <box
          border
          borderColor={nameActive ? theme.borderActive : theme.border}
          backgroundColor={nameActive ? theme.panelMuted : theme.background}
          padding={1}
        >
          <text fg={nameActive ? theme.text : theme.textMuted}>
            {snippetName}
            {nameActive ? '_' : ''}
          </text>
        </box>

        <text fg={contentActive ? theme.text : theme.textMuted}>Content:</text>
        <box
          border
          borderColor={contentActive ? theme.borderActive : theme.border}
          backgroundColor={contentActive ? theme.panelMuted : theme.background}
          padding={1}
        >
          <text fg={contentActive ? theme.text : theme.textMuted}>
            {snippetContent}
            {contentActive ? '_' : ''}
          </text>
        </box>
      </box>
    </box>
  )
}
