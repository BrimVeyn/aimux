import type { ResolvedTuiTheme } from '@brimveyn/aimux-config'
import type { PluginFileViewProps } from '@brimveyn/aimux-plugin'

import { isValidElement, memo, type ReactNode, useCallback, useMemo } from 'react'

import { useAppStore } from '../state/app-store'
import { getActiveWorkspacePath, getCurrentProject } from '../state/project-workspaces'
import { FileView as HostFileView } from './components/git/file-view/file-view'
import { BareInput } from './components/primitives/bare-input'
import { ListItem } from './components/primitives/list-item'
import { Surface } from './components/primitives/surface'
import { VirtualRows } from './components/primitives/virtual-rows'
import { useTheme } from './theme'
import { useThemeId } from './theme-store'

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
        // Not shrinkable, for the same reason a row is not: a heading squeezed
        // by a growing body below it does not get shorter, it disappears.
        <box flexShrink={0} paddingLeft={1} paddingRight={1}>
          <text fg={t.textMuted}>{title}</text>
        </box>
      )}
      {/* The body grows with the panel. Without this the frame grew and its
          filled area did not, so a plugin's `flexGrow` children were laid out
          in a box of no height at all — every row drawn on the same line. */}
      <Surface
        flexDirection="column"
        flexGrow={flexGrow}
        flexShrink={flexGrow === undefined ? undefined : 1}
        padding={padding}
        tone={tone}
      >
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
    /* Never shrinks: a row is one line by definition, and a column with a
       growing sibling would otherwise squeeze it to nothing — which does not
       hide it, it draws it on the line below. */
    <box flexDirection="row" flexShrink={0} paddingLeft={1} paddingRight={1}>
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
          // The same string as the React key, as a renderable id: a list long
          // enough to scroll is one whose cursor has to be scrolled *to*, and
          // `scrollChildIntoView` needs a name for the row.
          id={keyOf?.(item, index) ?? String(index)}
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

export interface VirtualListProps<T> {
  items: readonly T[]
  /** Index of the cursor's row, or -1 for none. The list keeps it in view. */
  selectedIndex?: number
  /** Stable key per item. Falls back to the index. */
  keyOf?: (item: T, index: number) => string
  /**
   * One line per item, nothing taller. `selected` is true on the cursor's row
   * while the list has focus — the row is filled then, and everything drawn on
   * it takes `selectionInk`.
   */
  renderItem: (item: T, index: number, selected: boolean) => ReactNode
  /** Shown instead of the list when `items` is empty. */
  empty?: ReactNode
  /**
   * False while the keys are elsewhere: the cursor's row stays marked, lifted
   * rather than filled, so the eye finds where it left off. True by default.
   */
  focused?: boolean
  onSelect?: (index: number) => void
  onHover?: (index: number) => void
}

interface VirtualRowProps {
  children: ReactNode
  fill: 'element' | 'primary' | null
  index: number
  onClickIndex?: (index: number) => void
  onHoverIndex?: (index: number) => void
}

const VirtualRow = memo(function VirtualRow({
  children,
  fill,
  index,
  onClickIndex,
  onHoverIndex,
}: VirtualRowProps): ReactNode {
  const t = usePluginTheme()
  const handleClick = useMemo(
    () => (onClickIndex === undefined ? undefined : () => onClickIndex(index)),
    [index, onClickIndex]
  )
  const handleHover = useMemo(
    () => (onHoverIndex === undefined ? undefined : () => onHoverIndex(index)),
    [index, onHoverIndex]
  )
  let background: string | undefined
  if (fill === 'primary') background = t.primary
  else if (fill === 'element') background = t.backgroundElement
  return (
    <box
      height={1}
      flexShrink={0}
      flexDirection="row"
      overflow="hidden"
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={background}
      onMouseDown={handleClick}
      onMouseOver={handleHover}
    >
      {children}
    </box>
  )
})

/**
 * A list of any length, one line per item. Only the rows on screen exist: a
 * `List` mounts every item, which is right for a picker and makes a tree of
 * twenty thousand files take seconds a keypress. The cursor is kept in view
 * the way vim keeps it, a few rows from the edge, and the wheel scrolls
 * without moving it.
 */
export function VirtualList<T>({
  empty,
  focused = true,
  items,
  keyOf,
  onHover,
  onSelect,
  renderItem,
  selectedIndex = -1,
}: VirtualListProps<T>): ReactNode {
  const t = usePluginTheme()
  const keyAt = useCallback(
    (index: number) => {
      const item = items[index] as T
      return keyOf?.(item, index) ?? String(index)
    },
    [items, keyOf]
  )
  const renderRow = useCallback(
    (index: number) => {
      const selected = index === selectedIndex
      let fill: VirtualRowProps['fill'] = null
      if (selected) fill = focused ? 'primary' : 'element'
      return (
        <VirtualRow fill={fill} index={index} onClickIndex={onSelect} onHoverIndex={onHover}>
          {renderItem(items[index] as T, index, selected && focused)}
        </VirtualRow>
      )
    },
    [focused, items, onHover, onSelect, renderItem, selectedIndex]
  )
  if (items.length === 0) {
    return empty === undefined ? null : paint(empty, t.textMuted)
  }
  return (
    <VirtualRows count={items.length} cursor={selectedIndex} keyOf={keyAt} renderRow={renderRow} />
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

/**
 * The checkout a plugin browses: the active workspace's, which is the one the
 * agent is editing — the same directory git mode diffs.
 */
export function useBrowsePath(): string | null {
  return useAppStore((s) => getActiveWorkspacePath(getCurrentProject(s)) ?? null)
}

/**
 * Git mode's renderers on one file of that checkout. A function component in
 * front of the forwardRef one: the kit's slots are plain calls, and the
 * controller a plugin hands over is the ref.
 */
export function FileView({
  controller,
  markdown,
  path,
  prefer,
  revision,
}: PluginFileViewProps): ReactNode {
  const cwd = useBrowsePath()
  const themeId = useThemeId()
  return (
    <HostFileView
      ref={controller}
      cwd={cwd}
      markdown={markdown}
      path={path}
      prefer={prefer}
      revision={revision}
      themeId={themeId}
    />
  )
}

/** A one-line field with a cursor: what aimux's own filters are drawn with. */
export function TextField({
  cursor,
  placeholder,
  value,
}: {
  cursor: number
  placeholder?: string
  value: string
}): ReactNode {
  return <BareInput cursorPos={cursor} placeholder={placeholder} value={value} />
}
