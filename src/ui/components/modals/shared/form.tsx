import type { ModeId } from '@brimveyn/aimux-config'
import type { ReactNode } from 'react'

import { useTheme } from '../../../theme'
import { InputField } from '../../primitives/input-field'
import { ListItem } from '../../primitives/list-item'
import { ModalShell } from './modal-shell'

interface FormProps {
  children: ReactNode
  footer?: ReactNode
  keybindsModeId?: ModeId
  listGap?: number
  subtitle?: string
  title: string
  width: number | `${number}%`
}

interface FieldLabelProps {
  active?: boolean
  children?: ReactNode
  description?: ReactNode
}

interface TextFieldProps {
  active: boolean
  cursorPos?: number
  description?: ReactNode
  label?: ReactNode
  placeholder?: string
  value: string
}

type FormOptionContent = ReactNode | ((active: boolean) => ReactNode)

export interface FormOptionItem {
  key: string
  leading?: FormOptionContent
  subtitle?: FormOptionContent
  title: FormOptionContent
  trailing?: FormOptionContent
  onClick?: () => void
}

interface AutoCompleteProps {
  active: boolean
  cursorPos?: number
  displayValue?: string
  emptyState?: ReactNode
  items: FormOptionItem[]
  label: ReactNode
  maxVisibleRows?: number
  onHover?: (index: number) => void
  placeholder?: string
  selectedIndex: number
  value: string
}

export function Form({
  children,
  footer,
  keybindsModeId,
  listGap,
  subtitle,
  title,
  width,
}: FormProps) {
  return (
    <ModalShell
      title={title}
      subtitle={subtitle}
      width={width}
      keybindsModeId={keybindsModeId}
      listGap={listGap}
      footer={footer}
    >
      {children}
    </ModalShell>
  )
}

export function FieldLabel({ active = false, children, description }: FieldLabelProps) {
  const t = useTheme()
  return (
    <box flexDirection="column">
      {children != null ? <text fg={active ? t.text : t.textMuted}>{children}</text> : null}
      {description != null ? <text fg={t.textMuted}>{description}</text> : null}
    </box>
  )
}

export function TextField({
  active,
  cursorPos,
  description,
  label,
  placeholder,
  value,
}: TextFieldProps) {
  return (
    <box flexDirection="column">
      {label != null || description != null ? (
        <FieldLabel active={active} description={description}>
          {label}
        </FieldLabel>
      ) : null}
      <InputField active={active} value={value} cursorPos={cursorPos} placeholder={placeholder} />
    </box>
  )
}

function resolveItemContent(content: FormOptionContent | undefined, active: boolean): ReactNode {
  return typeof content === 'function' ? content(active) : content
}

export function AutoComplete({
  active,
  cursorPos,
  displayValue,
  emptyState,
  items,
  label,
  maxVisibleRows = 8,
  onHover,
  placeholder,
  selectedIndex,
  value,
}: AutoCompleteProps) {
  const scrollOffset = Math.max(0, selectedIndex - maxVisibleRows + 1)
  const visibleItems = items.slice(scrollOffset, scrollOffset + maxVisibleRows)

  return (
    <box flexDirection="column" gap={1}>
      <TextField
        active={active}
        label={label}
        value={active ? value : (displayValue ?? value)}
        cursorPos={cursorPos}
        placeholder={placeholder}
      />
      <box flexDirection="column" height={maxVisibleRows}>
        {items.length === 0
          ? (emptyState ?? null)
          : visibleItems.map((item, index) => {
              const optionIndex = scrollOffset + index
              const optionActive = active && optionIndex === selectedIndex
              return (
                <ListItem
                  key={item.key}
                  index={optionIndex}
                  active={optionActive}
                  leading={resolveItemContent(item.leading, optionActive)}
                  title={resolveItemContent(item.title, optionActive)}
                  subtitle={resolveItemContent(item.subtitle, optionActive)}
                  trailing={resolveItemContent(item.trailing, optionActive)}
                  onHoverIndex={onHover}
                  onClick={item.onClick}
                />
              )
            })}
      </box>
    </box>
  )
}
