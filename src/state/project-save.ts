import type { AppState, ProjectRecord } from './types'

import { loadConfig, saveConfig } from '../config'
import { saveProjectCatalog } from './project-catalog'
import { serializeProject } from './project-persistence'

export function buildProjectsWithCurrentSnapshot(
  projects: ProjectRecord[],
  currentProjectId: string | null,
  state: AppState
): ProjectRecord[] {
  return projects.map((project) =>
    project.id === currentProjectId
      ? {
          ...project,
          projectSnapshot: serializeProject(state),
          updatedAt: new Date().toISOString(),
        }
      : project
  )
}

export function saveCurrentProject(state: AppState): void {
  saveConfig({
    ...loadConfig(),
    bars: state.bars,
    customCommands: state.customCommands,
    gitPane: {
      diffModeRatio: state.gitPane.diffModeRatio,
      fileListMode: state.gitPane.fileListMode,
    },
    projectBarVisible: state.projectBar.visible,
    // Legacy mirror of the left bar: lets an older build (and the project
    // snapshot schema) still find a sidebar after a downgrade.
    sidebar: {
      visible: state.bars.left.visible,
      width: state.bars.left.width,
    },
  })
  saveProjectCatalog(
    buildProjectsWithCurrentSnapshot(state.projects, state.currentProjectId, state)
  )
}
