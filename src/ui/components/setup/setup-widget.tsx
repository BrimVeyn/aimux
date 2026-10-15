import { memo, useCallback, useEffect, useState } from 'react'

import type { SideEffect } from '../../../input/modes/types'

import { measureGlobal } from '../../../app-runtime/measure-ref'
import { findSetupTab } from '../../../app-runtime/setup-actions'
import { usePaneSizeReport } from '../../../app-runtime/use-pane-size-report'
import { useAppStore } from '../../../state/app-store'
import { runSideEffectGlobal } from '../../../state/dispatch-ref'
import { hasSetupScript } from '../../../state/project-data'
import { getActiveWorkspace, getCurrentProject } from '../../../state/project-workspaces'
import { useBusySpinner } from '../../hooks/use-busy-spinner'
import { useBaseTheme, useTheme } from '../../theme'
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

interface Action {
  effect: SideEffect
  fg?: string
  icon: string
  text: string
}

/** Buttons are padded one cell each side and spaced one cell apart. */
function rowWidth(labels: string[]): number {
  return labels.reduce((sum, label) => sum + Bun.stringWidth(label) + 2, labels.length - 1)
}

/**
 * The richest labels that fit on one row: icon and word, then the word alone,
 * then the icon alone — so a narrow bar keeps every action instead of clipping
 * the last ones off its edge.
 */
export function fitActionLabels(actions: Pick<Action, 'icon' | 'text'>[], width: number): string[] {
  const full = actions.map((action) =>
    action.text === '' ? action.icon : `${action.icon} ${action.text}`
  )
  if (rowWidth(full) <= width) return full
  const words = actions.map((action) => (action.text === '' ? action.icon : action.text))
  if (rowWidth(words) <= width) return words
  return actions.map((action) => action.icon)
}

function Button({ effect, fg, label }: { effect: SideEffect; fg?: string; label: string }) {
  const t = useTheme()
  const onMouseDown = useCallback(() => runSideEffectGlobal(effect), [effect])

  return (
    <box
      paddingLeft={1}
      paddingRight={1}
      flexShrink={0}
      backgroundColor={t.backgroundElement}
      onMouseDown={onMouseDown}
    >
      <text selectable={false} fg={fg ?? t.text} wrapMode="none">
        {label}
      </text>
    </box>
  )
}

export const SetupWidget = memo(function SetupWidget({ contentWidth }: { contentWidth: number }) {
  const t = useTheme()
  // Opaque even in transparent mode: the emptied page token would let the
  // panel this sits on show through, and the well would vanish into it.
  const page = useBaseTheme().background
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

  const ranAt = workspace?.setupRanAt
  const exitCode = workspace?.setupExitCode
  const finished = ranAt != null && ranAt !== ''
  const running = setupTab !== undefined && !finished
  const spinner = useBusySpinner(running)

  if (!project || !workspace) {
    return (
      <box flexDirection="column" flexGrow={1} flexShrink={1} flexBasis={0} overflow="hidden">
        <text selectable={false} fg={t.textMuted} wrapMode="none">
          No workspace
        </text>
      </box>
    )
  }

  let statusText = 'not run'
  let statusFg = t.textMuted
  if (!scriptExists) {
    statusText = 'no script'
  } else if (running) {
    statusText = `${spinner} running`
    statusFg = t.primary
  } else if (finished) {
    statusText = exitCode === 0 ? '✓ ok' : `✗ exit ${exitCode ?? '?'}`
    statusFg = exitCode === 0 ? t.success : t.error
  }

  // The one action the state calls for is inked in its colour, so it is the
  // first button the eye lands on. The fill stays the element tone throughout.
  let run: Action = { effect: RUN, fg: t.primary, icon: '▶', text: 'Run' }
  if (running) run = { effect: STOP, fg: t.error, icon: '■', text: 'Stop' }
  else if (finished) run = { effect: RUN, fg: t.primary, icon: '↻', text: 'Re-run' }

  // Only Run depends on a script existing. Edit and Agent must not vanish the
  // moment one does, or writing a stub and closing the editor leaves no way to
  // ask an agent to fill it in — and no way out.
  const actions: Action[] = [
    ...(scriptExists ? [run] : []),
    scriptExists
      ? { effect: CONFIGURE, icon: '✎', text: 'Edit' }
      : { effect: CONFIGURE, fg: t.primary, icon: '+', text: 'Create' },
    { effect: ASK_AGENT, icon: '✦', text: 'Agent' },
    // A failing setup means reading a stack trace, which a bar this narrow
    // cannot do. This is the way out.
    ...(setupTab ? [{ effect: PROMOTE, icon: '↗', text: '' }] : []),
  ]
  const labels = fitActionLabels(actions, contentWidth)

  return (
    <box flexDirection="column" flexGrow={1} flexShrink={1} flexBasis={0} overflow="hidden">
      {/* Names the widget — the bar has no titles of its own — and says where the
          setup stands. No workspace name: the sidebar already shows the active
          one, and at this width it only ever showed up truncated. */}
      <box flexDirection="row" flexShrink={0} gap={1}>
        <text selectable={false} fg={t.text} wrapMode="none">
          <strong>Setup</strong>
        </text>
        <text selectable={false} fg={t.textMuted} wrapMode="none">
          ·
        </text>
        <text selectable={false} fg={statusFg} wrapMode="none">
          {statusText}
        </text>
      </box>

      <box flexDirection="row" flexShrink={0} gap={1} paddingTop={1} paddingBottom={1}>
        {actions.map((action, index) => (
          <Button
            key={action.text || action.icon}
            effect={action.effect}
            fg={action.fg}
            label={labels[index] ?? action.icon}
          />
        ))}
      </box>

      {/* The output is page, not chrome: painted like every other terminal so
          it reads as one, and always there so the layout does not jump when a
          run starts. The gutter sits outside the measured box, so the PTY is
          sized to the cells it actually draws in. */}
      <box
        flexDirection="column"
        flexGrow={1}
        overflow="hidden"
        backgroundColor={page}
        paddingLeft={1}
        paddingRight={1}
        paddingTop={1}
        paddingBottom={1}
      >
        {setupTab ? (
          <box
            ref={setContentBox}
            flexDirection="column"
            flexGrow={1}
            width="100%"
            overflow="hidden"
          >
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
    </box>
  )
})
