import { useCallback, useMemo } from 'react'

import type { ProjectRecord } from '../../../../state/types'

import { dispatchGlobal, runSideEffectGlobal } from '../../../../state/dispatch-ref'
import { filterProjects } from '../../../../state/selectors'
import { abbreviatePath } from '../../../path-format'
import { orderProjectsForDisplay } from '../../../project-ordering'
import { useTheme } from '../../../theme'
import { uiTokens } from '../../../ui-tokens'
import { Picker, type PickerItem } from '../shared/picker'

interface ProjectPickerModalProps {
  projects: ProjectRecord[]
  selectedIndex: number
  currentProjectId: string | null
  currentTabCount: number
  filter: string | null
  cursorPos?: number
}

function formatProjectLine(
  project: ProjectRecord,
  currentProjectId: string | null,
  currentTabCount: number,
  displayIndex: number
): string {
  const tabCount =
    project.id === currentProjectId
      ? currentTabCount
      : (project.workspaceSnapshot?.tabs.length ?? 0)
  return `[${displayIndex}] ${project.name} (${tabCount} tab${tabCount === 1 ? '' : 's'})`
}

function getEmptyStateMessage(hasFilter: boolean): string {
  if (hasFilter) return 'No matching workspaces.'
  return 'No workspaces yet. Press Enter or n to create your first workspace.'
}

export function ProjectPickerModal({
  currentProjectId,
  currentTabCount,
  cursorPos,
  filter,
  projects,
  selectedIndex,
}: ProjectPickerModalProps) {
  const t = useTheme()
  const ordered = useMemo(() => orderProjectsForDisplay(projects), [projects])
  const filtered = useMemo(() => filterProjects(ordered, filter), [filter, ordered])
  const hasFilter = !!(filter != null && filter !== '')

  const items = useMemo<PickerItem[]>(() => {
    const baselineOrder = ordered.map((s) => s.id)
    const projectItems: PickerItem[] = filtered.map((project, index) => {
      const active = index === selectedIndex
      const displayIndex = baselineOrder.indexOf(project.id) + 1
      return {
        key: project.id,
        onClick: () => runSideEffectGlobal({ type: 'confirm-selected-project' }),
        onDelete: () => runSideEffectGlobal({ type: 'delete-selected-project' }),
        subtitle:
          project.projectPath != null && project.projectPath !== '' ? (
            <text fg={t.textMuted}>{abbreviatePath(project.projectPath)}</text>
          ) : undefined,
        title: (
          <text fg={active ? t.text : t.textMuted}>
            {formatProjectLine(project, currentProjectId, currentTabCount, displayIndex)}
          </text>
        ),
      }
    })
    const createNewItem: PickerItem = {
      key: '__create-new__',
      onClick: () => runSideEffectGlobal({ type: 'confirm-selected-project' }),
      title: (
        <text fg={selectedIndex === filtered.length ? t.text : t.textMuted}>
          Create new workspace
        </text>
      ),
    }
    return [...projectItems, createNewItem]
  }, [currentProjectId, currentTabCount, filtered, ordered, selectedIndex, t])

  const handleHover = useCallback(
    (index: number) => dispatchGlobal({ index, type: 'set-modal-selection-index' }),
    []
  )

  return (
    <Picker
      title="Workspaces"
      keybindsModeId="modal.project-picker.filtering"
      width={uiTokens.modalWidth.lg}
      gap={1}
      filter={filter}
      cursorPos={cursorPos}
      items={items}
      selectedIndex={selectedIndex}
      emptyState={
        filtered.length === 0 ? (
          <text fg={t.textMuted}>{getEmptyStateMessage(hasFilter)}</text>
        ) : undefined
      }
      onHover={handleHover}
    />
  )
}
