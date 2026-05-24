import { type Toast, TOAST_CONFIG, type ToastPosition } from '../../../../state/toast-store'
import { ToastItem } from './toast-item'
import { parseToastPosition, stackContainerProps } from './toast-position'

const EDGE_MARGIN = 1

interface ToastStackProps {
  position: ToastPosition
  toasts: Toast[]
}

// One corner's column of toasts. Newest sits nearest the anchored edge; the stack
// is capped at maxVisible (older toasts drop off, though they usually auto-dismiss).
export function ToastStack({ position, toasts }: ToastStackProps) {
  const anchor = parseToastPosition(position)
  const recent = toasts.slice(-TOAST_CONFIG.maxVisible)
  const ordered = anchor.vertical === 'top' ? [...recent].reverse() : recent
  return (
    <box
      position="absolute"
      flexDirection="column"
      gap={TOAST_CONFIG.gap}
      {...stackContainerProps(anchor, EDGE_MARGIN)}
    >
      {ordered.map((toast) => (
        <ToastItem key={toast.id} toast={toast} anchor={anchor} />
      ))}
    </box>
  )
}
