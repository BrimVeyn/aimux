import type { ScriptFileResult } from '../../../../state/types'

import { dispatchGlobal } from '../../../../state/dispatch-ref'
import { useTheme } from '../../../theme'
import { uiTokens } from '../../../ui-tokens'
import { AutoComplete, Form, type FormOptionItem } from '../shared/form'

interface WorktreeScriptsModalProps {
  activeField: 'sanitize' | 'setup'
  setupScript: string
  sanitizeScript: string
  scriptResults: ScriptFileResult[]
  selectedIndex: number
  cursorPos?: number
}

export function WorktreeScriptsModal({
  activeField,
  cursorPos,
  sanitizeScript,
  scriptResults,
  selectedIndex,
  setupScript,
}: WorktreeScriptsModalProps) {
  const t = useTheme()
  const items: FormOptionItem[] = scriptResults.map((result) => ({
    key: result.path,
    onClick: () => dispatchGlobal({ type: 'select-script-file' }),
    title: <text fg={t.text}>{result.path}</text>,
  }))

  return (
    <Form
      title="Worktree setup"
      keybindsModeId="modal.worktree-scripts"
      width={uiTokens.modalWidth.xl}
    >
      <AutoComplete
        active={activeField === 'setup'}
        cursorPos={activeField === 'setup' ? cursorPos : undefined}
        items={activeField === 'setup' ? items : []}
        label="Setup script"
        selectedIndex={selectedIndex}
        value={setupScript}
        placeholder="./scripts/setup.sh"
        emptyState={<text fg={t.textMuted}>Type to search repo files.</text>}
        onHover={(index) => dispatchGlobal({ index, type: 'set-modal-selection-index' })}
      />
      <AutoComplete
        active={activeField === 'sanitize'}
        cursorPos={activeField === 'sanitize' ? cursorPos : undefined}
        items={activeField === 'sanitize' ? items : []}
        label="Sanitize script"
        selectedIndex={selectedIndex}
        value={sanitizeScript}
        placeholder="./scripts/sanitize.sh"
        emptyState={<text fg={t.textMuted}>Type to search repo files.</text>}
        onHover={(index) => dispatchGlobal({ index, type: 'set-modal-selection-index' })}
      />
    </Form>
  )
}
