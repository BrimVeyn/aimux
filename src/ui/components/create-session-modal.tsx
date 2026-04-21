import type { DirectoryResult } from '../../state/types'

import { abbreviatePath } from '../path-format'
import { getCurrentTokens, useTokens } from '../theme'
import { uiTokens } from '../ui-tokens'
import { InputField } from './input-field'
import { ListItem } from './list-item'
import { ModalShell } from './modal-shell'

const VISIBLE_ROWS = 8

function getDirectoryResultIcon(result: DirectoryResult): string {
  if (result.type === 'worktree') return '\u{e728}'
  if (result.type === 'workspace') return '\u{f07c}'
  return '\u{e702}'
}

function getDirectoryResultColor(result: DirectoryResult): string {
  const t = getCurrentTokens()
  if (result.type === 'worktree') return t.palette.warning
  if (result.type === 'workspace') return t.accent
  return t.palette.primary
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
  const t = useTokens()
  const dirActive = activeField === 'directory'
  const nameActive = activeField === 'name'

  const scrollOffset = Math.max(0, selectedIndex - VISIBLE_ROWS + 1)
  const visibleResults = results.slice(scrollOffset, scrollOffset + VISIBLE_ROWS)

  return (
    <ModalShell
      title="Create workspace"
      keybindsModeId="modal.create-session"
      width={uiTokens.modalWidth.xl}
    >
      <box flexDirection="column">
        <text fg={dirActive ? t.palette.ink : t.muted}>Search projects</text>
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
          <text fg={t.muted}>
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
                  <text fg={active ? t.palette.ink : t.muted}>{abbreviatePath(result.path)}</text>
                }
              />
            )
          })
        )}
      </box>

      <box flexDirection="column">
        <text fg={nameActive ? t.palette.ink : t.muted}>Workspace name</text>
        <InputField active={nameActive} value={sessionName} />
      </box>
    </ModalShell>
  )
}
