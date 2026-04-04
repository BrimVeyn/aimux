import type { DirectoryResult } from '../../state/types'

import { abbreviatePath } from '../path-format'
import { theme } from '../theme'
import { uiTokens } from '../ui-tokens'
import { InputField } from './input-field'
import { ListItem } from './list-item'
import { ModalShell } from './modal-shell'

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
    <ModalShell
      title="Create session"
      help="Tab switch field. Ctrl+n/p nav. Esc cancel."
      width={uiTokens.modalWidth.xl}
    >
      <box flexDirection="column">
        <text fg={dirActive ? theme.text : theme.textMuted}>Search projects</text>
        <InputField
          active={dirActive}
          value={
            pendingProjectPath && !dirActive ? abbreviatePath(pendingProjectPath) : directoryQuery
          }
        />
      </box>

      {dirActive && results.length === 0 && directoryQuery.length > 0 ? (
        <text fg={theme.textMuted}>No matches</text>
      ) : null}

      {dirActive
        ? results.map((result, index) => {
            const active = index === selectedIndex
            return (
              <ListItem
                key={result.path}
                active={active}
                leading={
                  <text fg={getDirectoryResultColor(result)}>{getDirectoryResultIcon(result)}</text>
                }
                title={
                  <text fg={active ? theme.text : theme.textMuted}>
                    {abbreviatePath(result.path)}
                  </text>
                }
              />
            )
          })
        : null}

      <box flexDirection="column">
        <text fg={nameActive ? theme.text : theme.textMuted}>Session name</text>
        <InputField active={nameActive} value={sessionName} />
      </box>
    </ModalShell>
  )
}
