import type { DirectoryResult } from '../../state/types'

import { abbreviatePath } from '../path-format'
import { theme } from '../theme'

const MODAL_WIDTH = '60%'

function getDirectoryResultIcon(result: DirectoryResult): string {
  if (result.type === 'worktree') {
    return '\u{e728}'
  }

  if (result.type === 'workspace') {
    return '\u{f07c}'
  }

  return '\u{e702}'
}

function getDirectoryResultColor(result: DirectoryResult): string {
  if (result.type === 'worktree') {
    return theme.warning
  }

  if (result.type === 'workspace') {
    return theme.accentAlt
  }

  return theme.accent
}

interface CreateSessionModalProps {
  activeField: 'directory' | 'name'
  directoryQuery: string
  sessionName: string
  results: DirectoryResult[]
  selectedIndex: number
  pendingProjectPath: string | null
}

export function CreateSessionModal({
  activeField,
  directoryQuery,
  pendingProjectPath,
  results,
  selectedIndex,
  sessionName,
}: CreateSessionModalProps) {
  const dirActive = activeField === 'directory'
  const nameActive = activeField === 'name'

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
        width={MODAL_WIDTH}
        border
        borderColor={theme.borderActive}
        padding={1}
        backgroundColor={theme.panel}
        flexDirection="column"
        gap={1}
      >
        <text fg={theme.accentAlt}>Create session</text>
        <text fg={theme.textMuted}>Tab switch field. Ctrl+n/p nav. Esc cancel.</text>

        <text fg={dirActive ? theme.text : theme.textMuted}>Search projects:</text>
        <box
          border
          borderColor={dirActive ? theme.borderActive : theme.border}
          backgroundColor={dirActive ? theme.panelMuted : theme.background}
          padding={1}
        >
          <text fg={dirActive ? theme.text : theme.textMuted}>
            {pendingProjectPath && !dirActive ? abbreviatePath(pendingProjectPath) : directoryQuery}
            {dirActive ? '_' : ''}
          </text>
        </box>

        {dirActive && results.length === 0 && directoryQuery.length > 0 ? (
          <text fg={theme.textMuted}>No matches</text>
        ) : null}
        {dirActive
          ? results.map((result, index) => {
              const active = index === selectedIndex
              return (
                <box key={result.path} flexDirection="row">
                  <text fg={active ? theme.text : theme.textMuted}>{active ? '>' : ' '} </text>
                  <text fg={getDirectoryResultColor(result)}>
                    {getDirectoryResultIcon(result)}{' '}
                  </text>
                  <text fg={active ? theme.text : theme.textMuted}>
                    {abbreviatePath(result.path)}
                  </text>
                </box>
              )
            })
          : null}

        <text fg={nameActive ? theme.text : theme.textMuted}>Session name:</text>
        <box
          border
          borderColor={nameActive ? theme.borderActive : theme.border}
          backgroundColor={nameActive ? theme.panelMuted : theme.background}
          padding={1}
        >
          <text fg={nameActive ? theme.text : theme.textMuted}>
            {sessionName}
            {nameActive ? '_' : ''}
          </text>
        </box>
      </box>
    </box>
  )
}
