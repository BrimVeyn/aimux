import { useMemo } from 'react'

import type { DirectoryResult } from '../../../../state/types'

import { abbreviatePath } from '../../../path-format'
import { getCurrentTheme, useTheme } from '../../../theme'
import { uiTokens } from '../../../ui-tokens'
import { AutoComplete, Form, type FormOptionItem, TextField } from '../shared/form'

const VISIBLE_ROWS = 8

function getDirectoryResultIcon(result: DirectoryResult): string {
  if (result.type === 'workspace') return '\u{e728}'
  if (result.type === 'project') return '\u{f07c}'
  return '\u{e702}'
}

function getDirectoryResultColor(result: DirectoryResult): string {
  const t = getCurrentTheme()
  if (result.type === 'workspace') return t.warning
  if (result.type === 'project') return t.info
  return t.text
}

interface CreateProjectModalProps {
  activeField: 'directory' | 'name'
  directoryQuery: string
  projectName: string
  results: DirectoryResult[]
  selectedIndex: number
  pendingProjectPath: string | null
}

export function CreateProjectModal({
  activeField,
  directoryQuery,
  pendingProjectPath,
  projectName,
  results,
  selectedIndex,
}: CreateProjectModalProps) {
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
      title="Create project"
      keybindsModeId="modal.create-project"
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

      <TextField active={nameActive} label="Project name" value={projectName} />
    </Form>
  )
}
