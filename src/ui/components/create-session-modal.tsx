import type { DirectoryResult } from '../../state/types'

import { abbreviatePath } from '../path-format'
import { getCurrentTheme, useTheme } from '../theme'
import { uiTokens } from '../ui-tokens'
import { InputField } from './input-field'
import { ListItem } from './list-item'
import { ModalShell } from './modal-shell'

const VISIBLE_ROWS = 8

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
    return getCurrentTheme().colors['editorWarning.foreground']
  }

  if (result.type === 'workspace') {
    return getCurrentTheme().colors['terminal.ansiMagenta']
  }

  return getCurrentTheme().colors['textLink.foreground']
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
  const theme = useTheme()
  const dirActive = activeField === 'directory'
  const nameActive = activeField === 'name'

  const scrollOffset = Math.max(0, selectedIndex - VISIBLE_ROWS + 1)
  const visibleResults = results.slice(scrollOffset, scrollOffset + VISIBLE_ROWS)

  return (
    <ModalShell
      title="Create session"
      keybindsModeId="modal.create-session"
      width={uiTokens.modalWidth.xl}
    >
      <box flexDirection="column">
        <text
          fg={dirActive ? theme.colors['editor.foreground'] : theme.colors['descriptionForeground']}
        >
          Search projects
        </text>
        <InputField
          active={dirActive}
          placeholder="Type a project name..."
          value={
            pendingProjectPath && !dirActive ? abbreviatePath(pendingProjectPath) : directoryQuery
          }
        />
      </box>

      <box flexDirection="column" height={VISIBLE_ROWS}>
        {results.length === 0 ? (
          <text fg={theme.colors['descriptionForeground']}>
            {directoryQuery.length > 0 ? 'No matches' : 'Type a project name to search...'}
          </text>
        ) : (
          visibleResults.map((result, index) => {
            const active = dirActive && scrollOffset + index === selectedIndex
            return (
              <ListItem
                key={result.path}
                active={active}
                leading={
                  <text fg={getDirectoryResultColor(result)}>{getDirectoryResultIcon(result)}</text>
                }
                title={
                  <text
                    fg={
                      active
                        ? theme.colors['editor.foreground']
                        : theme.colors['descriptionForeground']
                    }
                  >
                    {abbreviatePath(result.path)}
                  </text>
                }
              />
            )
          })
        )}
      </box>

      <box flexDirection="column">
        <text
          fg={
            nameActive ? theme.colors['editor.foreground'] : theme.colors['descriptionForeground']
          }
        >
          Session name
        </text>
        <InputField active={nameActive} value={sessionName} />
      </box>
    </ModalShell>
  )
}
