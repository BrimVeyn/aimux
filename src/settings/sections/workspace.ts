import type { ProjectRecord } from '../../state/types'
import type { SettingRow, SettingSection } from '../types'

import { runSideEffectGlobal } from '../../state/dispatch-ref'

const BASE_REF_ROW_PREFIX = 'workspace.defaultBaseRef.'

/**
 * One row per project, over `defaultBaseRef` on its catalog record.
 *
 * Per project rather than global because the convention belongs to the repo:
 * one clone branches off `develop`, the next off `main`, and a single value
 * would be wrong for every repo but one. Left empty it follows whatever the
 * repo declares as its default branch, which is the right answer most of the
 * time and the reason this is a row and not a prompt.
 */
function defaultBaseRefRow(project: ProjectRecord): SettingRow {
  return {
    description: "Branch new workspaces fork from. Empty follows the repo's own default.",
    id: `${BASE_REF_ROW_PREFIX}${project.id}`,
    kind: 'text',
    label: project.name,
    placeholder: "the repo's default",
    // Read through the live state, not the record this row was built from: the
    // screen rebuilds its rows from the same list it just wrote to.
    read: (ctx) =>
      ctx.state.projects.find((entry) => entry.id === project.id)?.defaultBaseRef ?? '',
    storage: 'app',
    write: (value) =>
      runSideEffectGlobal({
        baseRef: String(value),
        projectId: project.id,
        type: 'set-project-default-base-ref',
      }),
  }
}

export const WORKSPACE_SECTION: SettingSection = {
  glyph: '\u{2302}',
  id: 'workspace',
  label: 'Workspaces',
  rowCount: (projects) => projects.length,
  rows: (projects: readonly ProjectRecord[]) =>
    projects.map((project) => defaultBaseRefRow(project)),
}
