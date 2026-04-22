export type SidebarScrollTarget = 'none' | 'active-item' | 'top' | 'bottom'

interface SidebarScrollTargetOptions {
  previousActiveIndex: number
  nextActiveIndex: number
  tabCount: number
}

export function getSidebarScrollTarget({
  nextActiveIndex,
  previousActiveIndex,
  tabCount,
}: SidebarScrollTargetOptions): SidebarScrollTarget {
  if (tabCount === 0 || nextActiveIndex < 0) {
    return 'none'
  }

  if (previousActiveIndex < 0 || previousActiveIndex === nextActiveIndex) {
    return previousActiveIndex < 0 ? 'active-item' : 'none'
  }

  const lastIndex = tabCount - 1

  if (previousActiveIndex === lastIndex && nextActiveIndex === 0) {
    return 'top'
  }

  if (previousActiveIndex === 0 && nextActiveIndex === lastIndex) {
    return 'bottom'
  }

  return 'active-item'
}
