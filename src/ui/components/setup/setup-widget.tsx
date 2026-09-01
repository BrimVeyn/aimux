import { memo, useCallback, useEffect, useState } from 'react'

import type { SideEffect } from '../../../input/modes/types'

import { measureGlobal } from '../../../app-runtime/measure-ref'
import { findSetupTab } from '../../../app-runtime/setup-actions'
import { usePaneSizeReport } from '../../../app-runtime/use-pane-size-report'
import { useAppStore } from '../../../state/app-store'
import { runSideEffectGlobal } from '../../../state/dispatch-ref'
import { hasSetupScript } from '../../../state/project-data'
import { getCurrentProject } from '../../../state/project-workspaces'
import { getActiveWorkspace } from '../../../state/workspace-view'
import { useTheme, useTransparent } from '../../theme'
import { TerminalViewport } from '../layout/terminal-pane'

/**
 * How often the widget re-checks whether a setup script exists. Needed because
 * the file can appear with no state change behind it — an agent writing it, or
 * the user saving in their editor. Cheap `existsSync`; checking on every render
 * would fire a syscall per PTY frame.
 */
const SCRIPT_POLL_MS = 2_000

// Hoisted so they are stable prop identities across renders.
const RUN: SideEffect = { type: 'run-setup' }
const STOP: SideEffect = { type: 'stop-setup' }
const CONFIGURE: SideEffect = { type: 'configure-setup-script' }
const ASK_AGENT: SideEffect = { type: 'ask-agent-for-setup-script' }
const PROMOTE: SideEffect = { type: 'promote-setup-tab' }

function Button({ effect, label }: { effect: SideEffect; label: string }) {
  const t = useTheme()
  const transparent = useTransparent()
  const onMouseDown = useCallback(() => runSideEffectGlobal(effect), [effect])

  return (
    <box
      paddingLeft={1}
      paddingRight={1}
      flexShrink={0}
      backgroundColor={transparent ? undefined : t.backgroundElement}
      onMouseDown={onMouseDown}
    >
      <text selectable={false} fg={t.text} wrapMode="none">
        {label}
      </text>
    </box>
  )
}

export const SetupWidget = memo(function SetupWidget() {
  const t = useTheme()
  const currentProjectId = useAppStore((s) => s.currentProjectId)
  const projects = useAppStore((s) => s.projects)

  const project = getCurrentProject({ currentProjectId, projects })
  const workspace = getActiveWorkspace(project)

  // Selecting the tab rather than the whole `tabs` array: that array gets a new
  // identity on every viewport frame of every terminal, so subscribing to it
  // re-renders this widget at the rate the other PTYs print. The found tab keeps
  // its identity until it changes, which is exactly when a redraw is due.
  const setupTab = useAppStore((s) => findSetupTab(s.tabs, workspace?.id))

  const [scriptExists, setScriptExists] = useState(false)
  useEffect(() => {
    if (project === undefined) {
      setScriptExists(false)
      return
    }
    const projectId = project.id
    const check = () => setScriptExists(hasSetupScript(projectId))
    check()
    const timer = setInterval(check, SCRIPT_POLL_MS)
    return () => clearInterval(timer)
  }, [project])

  // The PTY is sized from this box, not from the main terminal area — the resize
  // cascade skips hidden tabs precisely so this is the only authority.
  const setContentBox = usePaneSizeReport(setupTab?.id, setupTab !== undefined, measureGlobal)

  if (!project || !workspace) {
    return (
      <box flexDirection="column" flexGrow={1} flexShrink={1} flexBasis={0} overflow="hidden">
        <text selectable={false} fg={t.textMuted} wrapMode="none">
          No workspace
        </text>
      </box>
    )
  }

  const ranAt = workspace.setupRanAt
  const exitCode = workspace.setupExitCode
  const finished = ranAt != null && ranAt !== ''
  const running = setupTab !== undefined && !finished

  let statusText = 'not run here'
  let statusFg = t.textMuted
  if (!scriptExists) {
    statusText = 'no setup script'
  } else if (running) {
    statusText = 'running…'
    statusFg = t.primary
  } else if (finished) {
    statusText = exitCode === 0 ? '✓ setup ok' : `✗ exit ${exitCode ?? '?'}`
    statusFg = exitCode === 0 ? t.success : t.error
  }

  let runLabel = 'Run'
  if (running) runLabel = 'Stop'
  else if (finished) runLabel = 'Re-run'

  return (
    <box flexDirection="column" flexGrow={1} flexShrink={1} flexBasis={0} overflow="hidden">
      <box flexDirection="row" flexShrink={0} justifyContent="space-between" gap={1}>
        <text selectable={false} fg={statusFg} wrapMode="none">
          {statusText}
        </text>
        <text selectable={false} fg={t.textMuted} wrapMode="none">
          {workspace.name}
        </text>
      </box>

      {/* Only Run depends on a script existing. Edit and Agent must not vanish
          the moment one does, or writing a stub and closing the editor leaves no
          way to ask an agent to fill it in — and no way out. */}
      <box flexDirection="row" flexShrink={0} gap={1} paddingTop={1} paddingBottom={1}>
        {scriptExists ? <Button effect={running ? STOP : RUN} label={runLabel} /> : null}
        <Button effect={CONFIGURE} label={scriptExists ? 'Edit' : 'Create'} />
        <Button effect={ASK_AGENT} label="Agent" />
        {/* A failing setup means reading a stack trace, which a bar this narrow
            cannot do. This is the way out. */}
        {setupTab ? <Button effect={PROMOTE} label="↗" /> : null}
      </box>

      {setupTab ? (
        <box ref={setContentBox} flexDirection="column" flexGrow={1} width="100%" overflow="hidden">
          <TerminalViewport
            buffer={setupTab.buffer}
            softCursor={false}
            viewport={setupTab.viewport}
          />
        </box>
      ) : (
        <text selectable={false} fg={t.textMuted} wrapMode="word">
          {scriptExists
            ? 'Runs automatically in each new workspace.'
            : 'A setup script installs what a fresh worktree lacks: dependencies, .env, caches.'}
        </text>
      )}
    </box>
  )
})
