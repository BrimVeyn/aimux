import { useMemo } from 'react'

import type { DirectoryResult } from '../../../../state/types'

import { abbreviatePath } from '../../../path-format'
import { getCurrentTheme, useTheme } from '../../../theme'
import { uiTokens } from '../../../ui-tokens'
import { AutoComplete, Form, type FormOptionItem, TextField } from '../shared/form'

const VISIBLE_ROWS = 8

function getDirectoryResultIcon(result: DirectoryResult): string {
  if (result.type === 'worktree') return '\u{e728}'
  if (result.type === 'workspace') return '\u{f07c}'
  return '\u{e702}'
}

function getDirectoryResultColor(result: DirectoryResult): string {
  const t = getCurrentTheme()
  if (result.type === 'worktree') return t.warning
  if (result.type === 'workspace') return t.info
  return t.text
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
  const t = useTheme()
  const dirActive = activeField === 'directory'
  const nameActive = activeField === 'name'

  const items = useMemo<FormOptionItem[]>(
    () =>
      results.map((result) => ({
        key: result.path,
        leading: <text fg={getDirectoryResultColor(result)}>{getDirectoryResultIcon(result)}</text>,
        title: (active) => (
          <text fg={active ? t.text : t.textMuted}>{abbreviatePath(result.path)}</text>
        ),
      })),
    [results, t]
  )

  return (
    <Form
      title="Create workspace"
      keybindsModeId="modal.create-session"
      width={uiTokens.modalWidth.xl}
    >
      <AutoComplete
        active={dirActive}
        label="Search projects"
        placeholder="Type a project name..."
        value={directoryQuery}
        displayValue={
          pendingProjectPath != null && pendingProjectPath !== ''
            ? abbreviatePath(pendingProjectPath)
            : directoryQuery
        }
        items={items}
        selectedIndex={selectedIndex}
        maxVisibleRows={VISIBLE_ROWS}
        emptyState={
          <text fg={t.textMuted}>
            {directoryQuery.length > 0 ? 'No matches' : 'Type a project name to search...'}
          </text>
        }
      />

      <TextField active={nameActive} label="Workspace name" value={sessionName} />
    </Form>
  )
}
