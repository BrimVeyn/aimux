import type { ReactNode } from 'react'

import { GitPaneWidget } from '../components/git/pane/git-pane-widget'
import { ProjectList } from '../components/layout/sidebar/project-list'
import { SetupWidget } from '../components/setup/setup-widget'

/**
 * Everything a bar can host. Adding a widget = one entry here plus its id in
 * `KNOWN_WIDGET_IDS` (src/state/bars.ts) and in the default layout.
 */
export const WIDGET_RENDERERS: Record<string, (contentWidth: number) => ReactNode> = {
  git: (contentWidth) => <GitPaneWidget contentWidth={contentWidth} pollingEnabled />,
  projects: (contentWidth) => <ProjectList contentWidth={contentWidth} />,
  setup: () => <SetupWidget />,
}

export const WIDGET_LABELS: Record<string, string> = {
  git: 'Git',
  projects: 'Projects',
  setup: 'Setup',
}
