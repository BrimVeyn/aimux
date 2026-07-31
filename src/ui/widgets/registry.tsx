import type { ReactNode } from 'react'

import { GitPaneWidget } from '../components/git/pane/git-pane-widget'
import { WorkspaceList } from '../components/layout/sidebar/workspace-list'

/**
 * Everything a bar can host. Adding a widget = one entry here plus its id in
 * `KNOWN_WIDGET_IDS` (src/state/bars.ts) and in the default layout.
 */
export const WIDGET_RENDERERS: Record<string, (contentWidth: number) => ReactNode> = {
  git: () => <GitPaneWidget pollingEnabled />,
  workspaces: (contentWidth) => <WorkspaceList contentWidth={contentWidth} />,
}

export const WIDGET_LABELS: Record<string, string> = {
  git: 'Git',
  workspaces: 'Workspaces',
}
