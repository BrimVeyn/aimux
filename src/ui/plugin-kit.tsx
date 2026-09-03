import type { ResolvedTuiTheme } from '@brimveyn/aimux-config'

import { isValidElement, type ReactNode } from 'react'

import { ListItem } from './components/primitives/list-item'
import { Surface } from './components/primitives/surface'
import { useTheme } from './theme'

/**
 * The primitive kit a plugin renders with.
 *
 * A plugin author should not have to learn opentui's box model, or which of
 * thirty theme tokens is the right one for a muted label, to put a list on the
 * screen and have it look like the rest of aimux. These are the four shapes
 * every built-in screen is already made of, re-exposed with the aimux styling
 * already applied.
 *
 * Deliberately small. It is not a component library — a plugin that needs
 * something else drops to `<box>` and `<text>` and styles it from
 * `usePluginTheme()`, which is the same thing every built-in view does.
 */

/**
 * The resolved theme, as a hook. The one thing a plugin must not hard-code:
 * aimux ships 34 themes and loads more from disk, and a plugin with its own
 * colours is the one part of the screen that stops matching when the user
 * switches.
 */
export function usePluginTheme(): ResolvedTuiTheme {
  return useTheme()
}

/**
 * Whether a node belongs *inside* a `<text>` or *instead of* one.
 *
 * opentui's text node takes strings, spans and styled text and nothing else: a
 * `<text>` nested in a `<text>` throws at mount rather than merely drawing
 * wrong, and it takes the whole screen down with it. The kit's slots are
 * `ReactNode` on purpose — a row's subject is sometimes a word and sometimes a
 * glyph the caller has already coloured — so the kit is the one that has to
 * tell them apart. A word gets the slot's colour; anything that paints itself
 * is placed exactly as it is.
 */
function isInline(node: ReactNode): boolean {
  if (node === null || node === undefined || typeof node === 'boolean') return true
  if (typeof node === 'string' || typeof node === 'number') return true
  if (Array.isArray(node)) return node.every((child) => isInline(child as ReactNode))
  return isValidElement(node) && node.type === 'span'
}

/** The slot's own colour on inline content, and hands off anything else. */
function paint(node: ReactNode, fg: string): ReactNode {
  return isInline(node) ? <text fg={fg}>{node}</text> : node
}

export interface PanelProps {
  children?: ReactNode
  /** Drawn as a heading above the body when given. */
  title?: string
  /** `elevated` for something that sits on top; `muted` is the panel default. */
  tone?: 'muted' | 'elevated'
  padding?: number
  flexGrow?: number
}

/** A titled container. The shape a bar widget and a full-screen view both take. */
export function Panel({
  children,
  flexGrow,
  padding = 1,
  title,
  tone = 'muted',
}: PanelProps): ReactNode {
  const t = usePluginTheme()
  return (
    <box flexDirection="column" flexGrow={flexGrow}>
      {title === undefined ? null : (
        <box paddingLeft={1} paddingRight={1}>
          <text fg={t.textMuted}>{title}</text>
        </box>
      )}
      <Surface flexDirection="column" padding={padding} tone={tone}>
        {children}
      </Surface>
    </box>
  )
}

export interface RowProps {
  /** Left-aligned. The row's subject. */
  label: ReactNode
  /** Right-aligned, muted. The row's value. */
  value?: ReactNode
  /** Dims the whole row — for something unavailable rather than merely empty. */
  dim?: boolean
}

/** A label/value line. What every settings and stats row already is. */
export function Row({ dim = false, label, value }: RowProps): ReactNode {
  const t = usePluginTheme()
  return (
    <box flexDirection="row" paddingLeft={1} paddingRight={1}>
      <box flexGrow={1}>{paint(label, dim ? t.textMuted : t.text)}</box>
      {value === undefined ? null : paint(value, t.textMuted)}
    </box>
  )
}

export interface ListProps<T> {
  items: readonly T[]
  /** Index of the highlighted item, or -1 for none. */
  selectedIndex?: number
  /** Stable key per item. Falls back to the index. */
  keyOf?: (item: T, index: number) => string
  renderItem: (item: T, index: number) => ReactNode
  /** Shown instead of the list when `items` is empty. */
  empty?: ReactNode
  onSelect?: (index: number) => void
  onHover?: (index: number) => void
}

/**
 * A selectable list, with the cursor glyph, the selection highlight and the
 * mouse wiring the built-in pickers use.
 */
export function List<T>({
  empty,
  items,
  keyOf,
  onHover,
  onSelect,
  renderItem,
  selectedIndex = -1,
}: ListProps<T>): ReactNode {
  const t = usePluginTheme()
  if (items.length === 0) {
    return empty === undefined ? null : paint(empty, t.textMuted)
  }
  return (
    <box flexDirection="column">
      {items.map((item, index) => (
        <ListItem
          active={index === selectedIndex}
          index={index}
          key={keyOf?.(item, index) ?? String(index)}
          onClickIndex={onSelect}
          onHoverIndex={onHover}
          title={renderItem(item, index)}
        />
      ))}
    </box>
  )
}

export interface KeyHintProps {
  /** `[{ keys: 'q', label: 'close' }, …]`, in the order they should read. */
  hints: readonly { keys: string; label: string }[]
}

/**
 * The footer line every modal and screen ends with. Rendering it by hand is
 * how a plugin's hints end up in a different order, colour and separator from
 * everything else.
 */
export function KeyHint({ hints }: KeyHintProps): ReactNode {
  const t = usePluginTheme()
  if (hints.length === 0) return null
  return (
    <box flexDirection="row" paddingLeft={1} paddingRight={1}>
      {hints.map((hint, index) => (
        <text key={hint.keys}>
          {index === 0 ? '' : <span fg={t.textMuted}>{'  '}</span>}
          <span fg={t.primary}>{hint.keys}</span>
          <span fg={t.textMuted}>{` ${hint.label}`}</span>
        </text>
      ))}
    </box>
  )
}
