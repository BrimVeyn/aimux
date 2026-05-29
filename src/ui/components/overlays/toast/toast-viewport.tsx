import { type Toast, type ToastPosition, useToastStore } from '../../../../state/toast-store'
import { ToastStack } from './toast-stack'

// Mounted once at the root. Groups active toasts by position and renders one
// absolutely-positioned stack per occupied corner, on top of everything else.
export function ToastViewport() {
  const toasts = useToastStore((state) => state.toasts)
  if (toasts.length === 0) return null

  const byPosition = new Map<ToastPosition, Toast[]>()
  for (const entry of toasts) {
    const group = byPosition.get(entry.position) ?? []
    group.push(entry)
    byPosition.set(entry.position, group)
  }

  return (
    <>
      {[...byPosition].map(([position, group]) => (
        <ToastStack key={position} position={position} toasts={group} />
      ))}
    </>
  )
}
