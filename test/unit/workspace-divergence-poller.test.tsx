import { testRender } from '@opentui/react/test-utils'
import { afterEach, expect, mock, test } from 'bun:test'

import type { ProjectRecord } from '../../src/state/types'

import * as divergence from '../../src/git/divergence'
import { appStore } from '../../src/state/app-store'
import { setActiveDispatch } from '../../src/state/dispatch-ref'

// What this poller wastes is git subprocesses, so subprocesses are what to
// count. The real module is spread back in: bun applies a module mock to the
// whole run, and every other export has to keep working for the rest of it.
let gitCalls = 0
// Captured before the mock replaces the live bindings, or the wrappers recurse.
const realDivergence = divergence.getBranchDivergence
const realDiffStat = divergence.getWorkspaceDiffStat
void mock.module('../../src/git/divergence', () => ({
  ...divergence,
  getBranchDivergence: async (...args: Parameters<typeof realDivergence>) => {
    gitCalls += 1
    return realDivergence(...args)
  },
  getWorkspaceDiffStat: async (...args: Parameters<typeof realDiffStat>) => {
    gitCalls += 1
    return realDiffStat(...args)
  },
}))

const { useWorkspaceDivergencePolling } = await import('../../src/git/workspace-divergence-poller')

function project(id: string, branch: string): ProjectRecord {
  const at = '2024-01-01T00:00:00Z'
  return {
    createdAt: at,
    id,
    lastOpenedAt: at,
    name: id,
    order: 0,
    updatedAt: at,
    workspaces: [
      {
        branch,
        createdAt: at,
        createdByAimux: false,
        id: `${id}-ws`,
        name: 'checkout',
        path: `/tmp/aimux-not-a-repo-${id}`,
        repoRoot: `/tmp/aimux-not-a-repo-${id}`,
        source: 'primary',
        updatedAt: at,
      },
    ],
  }
}

function Probe() {
  useWorkspaceDivergencePolling(true)
  return <text>probe</text>
}

afterEach(() => {
  setActiveDispatch(null)
})

/**
 * The poller used to take `projects` as an effect dependency. Every workspace
 * switch replaces that array, so holding `j` in the sidebar tore the loop down
 * and fired a fresh git fan-out — ~200ms of subprocesses on a 13-workspace
 * setup — per keypress, all of it then discarded. One tick per interval, not
 * one per keystroke.
 */
test('a burst of project updates does not re-fire the git fan-out', async () => {
  setActiveDispatch(() => {})
  appStore.setState({ currentProjectId: 'a', projects: [project('a', 'main')] })

  const { renderOnce } = await testRender(<Probe />, { height: 4, width: 20 })
  await renderOnce()
  await new Promise((resolve) => setTimeout(resolve, 100))
  const afterFirstTick = gitCalls
  expect(afterFirstTick).toBeGreaterThan(0)

  // What holding `j` looks like: a new `projects` array on every keypress.
  for (let i = 0; i < 20; i++) {
    appStore.setState({ projects: [project('a', 'main')] })
    await renderOnce()
  }
  await new Promise((resolve) => setTimeout(resolve, 250))

  expect(gitCalls).toBe(afterFirstTick)
})
