import type { AppState } from '../../state/types'
import type { SettingRow, SettingSection } from '../types'

import { runSideEffectGlobal } from '../../state/dispatch-ref'
import { readSetupScriptLines, writeSetupCommand } from '../../state/project-data'

const SETUP_ROW_PREFIX = 'setup.script.'

/**
 * One row per project, over the setup script at
 * `~/.config/aimux/<profile>/projects/<id>/setup.sh`.
 *
 * A script whose work is a single command is editable here, which is the case
 * this section exists for — `bun install && cp .env.example .env` should not
 * require opening an editor. A script with more than one line of work is shown
 * but not editable: a one-line field cannot round-trip it, and overwriting it
 * from here would destroy whatever was there. Those hand over to the editor
 * instead.
 */
function setupRow(projectId: string, projectName: string): SettingRow {
  const lines = readSetupScriptLines(projectId)

  if (lines.length > 1) {
    return {
      description: `${String(lines.length)} lines — too much for one field. Opens your editor.`,
      id: `${SETUP_ROW_PREFIX}${projectId}`,
      kind: 'action',
      label: projectName,
      run: () => runSideEffectGlobal({ projectId, type: 'configure-setup-script' }),
      value: () => `${String(lines.length)} lines ›`,
    }
  }

  return {
    description: 'Runs once in each new workspace, from its root.',
    id: `${SETUP_ROW_PREFIX}${projectId}`,
    kind: 'text',
    label: projectName,
    placeholder: 'nothing yet',
    // The file, not the state: this is the only row whose value lives on disk,
    // and the screen re-reads it after every write.
    read: () => lines[0] ?? '',
    storage: 'app',
    write: (value) => writeSetupCommand(projectId, String(value)),
  }
}

function buildSetupRows(state: AppState): SettingRow[] {
  return state.projects.map((project) => setupRow(project.id, project.name))
}

export const SETUP_SECTION: SettingSection = {
  id: 'setup',
  label: 'Setup',
  rows: buildSetupRows,
}
