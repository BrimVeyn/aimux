import { useTerminalDimensions } from '@opentui/react'
import { useEffect } from 'react'

import {
  type Toast,
  TOAST_CONFIG,
  toastStore,
  type ToastVariant,
} from '../../../../state/toast-store'
import { type ResolvedTuiTheme, useTheme } from '../../../theme'
import { Surface } from '../../primitives/surface'
import { slideOffsetStyle, type ToastAnchor } from './toast-position'
import { useToastAnimation } from './use-toast-animation'

// Cells the toast travels vertically for center anchors (compact, since the card
// is only a few rows tall); horizontal anchors travel the full card width.
const VERTICAL_SLIDE = 4

function variantStyle(variant: ToastVariant, t: ResolvedTuiTheme): { color: string; icon: string } {
  switch (variant) {
    case 'success':
      return { color: t.success, icon: '✓' }
    case 'warning':
      return { color: t.warning, icon: '⚠' }
    case 'error':
      return { color: t.error, icon: '✗' }
    case 'info':
      return { color: t.primary, icon: '●' }
  }
}

interface ToastItemProps {
  toast: Toast
  anchor: ToastAnchor
}

export function ToastItem({ anchor, toast }: ToastItemProps) {
  const t = useTheme()
  const dimensions = useTerminalDimensions()
  const { away, requestExit } = useToastAnimation({
    onExited: () => toastStore.getState().dismiss(toast.id),
    reduceMotion: TOAST_CONFIG.reduceMotion,
  })

  useEffect(() => {
    if (toast.durationMs <= 0) return
    const timer = setTimeout(() => requestExit(), toast.durationMs)
    return () => clearTimeout(timer)
  }, [toast.durationMs, requestExit])

  const width = Math.max(16, Math.min(TOAST_CONFIG.width, dimensions.width - 4))
  const distance = anchor.horizontal === 'center' ? VERTICAL_SLIDE : width + 2
  const margins = slideOffsetStyle(anchor, Math.round(away * distance))
  const { color, icon } = variantStyle(toast.variant, t)
  const hasTitle = toast.title != null && toast.title !== ''
  const hasMessage = toast.message != null && toast.message !== ''

  return (
    <box flexShrink={0} {...margins}>
      <Surface tone="elevated" paddingLeft={1} paddingRight={1} width={width}>
        {toast.content ?? (
          <box flexDirection="row" gap={1}>
            <text fg={color} selectable={false}>
              {icon}
            </text>
            <box flexDirection="column" flexGrow={1}>
              {hasTitle ? (
                <text fg={t.text} selectable={false} wrapMode="word">
                  <strong>{toast.title}</strong>
                </text>
              ) : null}
              {hasMessage ? (
                <text fg={t.textMuted} selectable={false} wrapMode="word">
                  {toast.message}
                </text>
              ) : null}
            </box>
          </box>
        )}
      </Surface>
    </box>
  )
}
