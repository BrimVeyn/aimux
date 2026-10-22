import { useTerminalDimensions } from '@opentui/react'
import { useEffect } from 'react'

import { mixColor } from '../../../../services/usage-history/stats'
import {
  type Toast,
  TOAST_CONFIG,
  toastStore,
  type ToastVariant,
} from '../../../../state/toast-store'
import { type ResolvedTuiTheme, useTheme } from '../../../theme'
import { slideOffsetStyle, type ToastAnchor } from './toast-position'
import { useToastAnimation } from './use-toast-animation'

// Cells the toast travels vertically for center anchors (compact, since the card
// is only a few rows tall); horizontal anchors travel the full card width.
const VERTICAL_SLIDE = 4
// How far the card's fill leans toward the severity colour. The plain element
// tone is one grey step off the panes and bars it floats over, which in many
// themes is no step at all; no surface carries the severity hue, so a tint of it
// stands apart everywhere while staying dark enough for body text.
const SEVERITY_TINT = 0.08
// Taller than any toast; the column clips it to the card.
const BAR = Array.from({ length: 24 }, () => '▌').join('\n')

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
  const distance = anchor.horizontal === 'center' ? VERTICAL_SLIDE : width + 4
  const margins = slideOffsetStyle(anchor, Math.round(away * distance))
  const { color, icon } = variantStyle(toast.variant, t)
  const hasTitle = toast.title != null && toast.title !== ''
  const hasMessage = toast.message != null && toast.message !== ''

  // No frame: a fill tinted toward the severity lifts the toast off whatever it
  // floats over, and the full colour rides a thin bar down the left edge,
  // like the sidebar's cursor bar (STYLE.md §1, §5). The bar is the only place
  // the colour is spent at full strength; the icon's shape already says the rest.
  return (
    <box flexShrink={0} {...margins}>
      <box
        flexDirection="row"
        backgroundColor={mixColor(t.backgroundElement, color, SEVERITY_TINT)}
        paddingRight={1}
        width={width}
      >
        {/* The sidebar cursor's half-block, one per row. Absolute and clipped,
            so the column takes the card's height instead of setting it. */}
        <box width={1} overflow="hidden">
          <text position="absolute" fg={color} selectable={false} wrapMode="none">
            {BAR}
          </text>
        </box>
        <box flexGrow={1} paddingLeft={1} paddingTop={1} paddingBottom={1}>
          {toast.content ?? (
            <box flexDirection="row" gap={1}>
              <text fg={t.textMuted} selectable={false}>
                {icon}
              </text>
              <box flexDirection="column" flexGrow={1}>
                {hasTitle ? (
                  <text fg={t.text} selectable={false} wrapMode="word">
                    <strong>{toast.title}</strong>
                  </text>
                ) : null}
                {hasMessage ? (
                  // Muted only under a title: alone, the message is the toast.
                  <text fg={hasTitle ? t.textMuted : t.text} selectable={false} wrapMode="word">
                    {toast.message}
                  </text>
                ) : null}
              </box>
            </box>
          )}
        </box>
      </box>
    </box>
  )
}
