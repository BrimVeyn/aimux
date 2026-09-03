import type { ReactNode } from 'react'

import { registerWidgetId } from '../../state/bars'
import { GitPaneWidget } from '../components/git/pane/git-pane-widget'
import { ProjectList } from '../components/layout/sidebar/project-list'
import { SetupWidget } from '../components/setup/setup-widget'

/** Re-exported so a widget consumer needs one import, not two. */
export { isWidgetRenderable } from '../../state/bars'

/**
 * Everything a bar can host. Built-ins are the table below; a plugin adds one
 * through `registerBarWidget`, which is the same registration the built-ins
 * would make if they were plugins — the plan's phase 4 turns `setup` into
 * exactly that.
 */

/**
 * `size` is a second argument rather than a replacement for the width: the
 * number already shipped under `apiVersion: 1`, and swapping it would break
 * every published plugin to save one parameter. `size.cols` is that number.
 */
export type WidgetRenderer = (contentWidth: number, size: WidgetSize) => ReactNode

export interface WidgetSize {
  cols: number
  rows: number
}

interface WidgetEntry {
  render: WidgetRenderer
  label: string
}

const BUILTIN_WIDGETS: Record<string, WidgetEntry> = {
  git: {
    label: 'Git',
    render: (contentWidth) => <GitPaneWidget contentWidth={contentWidth} pollingEnabled />,
  },
  projects: {
    label: 'Projects',
    render: (contentWidth) => <ProjectList contentWidth={contentWidth} />,
  },
  setup: { label: 'Setup', render: () => <SetupWidget /> },
}

const pluginWidgets = new Map<string, WidgetEntry>()
const listeners = new Set<() => void>()

function notify(): void {
  const current = [...listeners]
  for (const listener of current) listener()
}

export function onBarWidgetsChanged(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export interface BarWidgetDefinition {
  /** Qualified id, `<pluginId>.<widgetId>`. The kernel namespaces it. */
  id: string
  label: string
  render: WidgetRenderer
}

/**
 * Registers a bar widget. Returns one disposer that removes the renderer and
 * the id together — leaving one behind would mean either a bar reserving space
 * for something it cannot draw, or a widget nothing will place.
 */
export function registerBarWidget(widget: BarWidgetDefinition): () => void {
  const entry: WidgetEntry = { label: widget.label, render: widget.render }
  pluginWidgets.set(widget.id, entry)
  const unregisterId = registerWidgetId(widget.id)
  notify()

  return () => {
    if (pluginWidgets.get(widget.id) === entry) pluginWidgets.delete(widget.id)
    unregisterId()
    notify()
  }
}

/** Test seam. Never called by the app. */
export function clearBarWidgets(): void {
  pluginWidgets.clear()
  notify()
}

export function getWidgetRenderer(id: string): WidgetRenderer | undefined {
  return (BUILTIN_WIDGETS[id] ?? pluginWidgets.get(id))?.render
}

export function getWidgetLabel(id: string): string {
  return (BUILTIN_WIDGETS[id] ?? pluginWidgets.get(id))?.label ?? id
}
