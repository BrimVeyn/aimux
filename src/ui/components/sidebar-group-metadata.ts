import type { TabSession } from '../../state/types'

import { allLeafIds, type LayoutNode } from '../../state/layout-tree'

export interface TabGroupInfo {
  inLayout: boolean
  groupStart: number
  groupEnd: number
}

export function buildTabGroupInfo(
  layoutTrees: Record<string, LayoutNode>,
  tabs: TabSession[]
): Map<string, TabGroupInfo> {
  const tabGroupInfo = new Map<string, TabGroupInfo>()

  for (const tree of Object.values(layoutTrees)) {
    const ids = allLeafIds(tree)
    if (ids.length <= 1) {
      continue
    }

    const idSet = new Set(ids)
    let groupStart = -1
    let groupEnd = -1

    for (const [index, tab] of tabs.entries()) {
      if (!idSet.has(tab.id)) {
        continue
      }

      if (groupStart === -1) {
        groupStart = index
      }
      groupEnd = index
    }

    for (const id of ids) {
      tabGroupInfo.set(id, { groupEnd, groupStart, inLayout: true })
    }
  }

  return tabGroupInfo
}
