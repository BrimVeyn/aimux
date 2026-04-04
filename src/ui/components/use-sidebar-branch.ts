import { useEffect, useState } from 'react'

import { getCurrentBranch } from '../git-branch'

const BRANCH_POLL_INTERVAL_MS = 5_000

export function useSidebarBranch(projectPath: string | undefined): string | null {
  const [branch, setBranch] = useState<string | null>(null)

  useEffect(() => {
    if (!projectPath) {
      setBranch(null)
      return
    }

    let isCurrent = true
    const updateBranch = async () => {
      const nextBranch = await getCurrentBranch(projectPath)
      if (isCurrent) {
        setBranch(nextBranch)
      }
    }

    void updateBranch()
    const interval = setInterval(() => {
      void updateBranch()
    }, BRANCH_POLL_INTERVAL_MS)

    return () => {
      isCurrent = false
      clearInterval(interval)
    }
  }, [projectPath])

  return branch
}
