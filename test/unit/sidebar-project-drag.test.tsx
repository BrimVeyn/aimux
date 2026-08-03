import { testRender } from '@opentui/react/test-utils'
import { afterEach, describe, expect, test } from 'bun:test'

import type { AppAction } from '../../src/state/actions'
import type { ProjectRecord } from '../../src/state/types'

import { appStore } from '../../src/state/app-store'
import { setActiveDispatch, setActiveSideEffectRunner } from '../../src/state/dispatch-ref'
import { ProjectList } from '../../src/ui/components/layout/sidebar/project-list'

function makeProject(id: string, order: number): ProjectRecord {
  const at = `2024-01-0${order + 1}T00:00:00Z`
  return {
    createdAt: at,
    id,
    lastOpenedAt: at,
    name: `project-${id}`,
    order,
    updatedAt: at,
    workspaces: [
      {
        createdAt: at,
        createdByAimux: false,
        id: `${id}-ws`,
        name: 'checkout',
        path: `/tmp/${id}`,
        repoRoot: `/tmp/${id}`,
        source: 'primary',
        updatedAt: at,
      },
    ],
  }
}

afterEach(() => {
  setActiveDispatch(null)
  setActiveSideEffectRunner(null)
})

/**
 * The sidebar drag is mouse-only, so it can only be checked by driving real
 * mouse events through a renderer — every past break (pointer capture landing
 * on the wrong row, handlers reading stale React state) was invisible to a
 * pure-function test.
 */
describe('sidebar project drag', () => {
  test('dragging a project heading onto a later slot previews and reorders', async () => {
    const projects = [makeProject('a', 0), makeProject('b', 1), makeProject('c', 2)]
    appStore.setState({ currentProjectId: 'a', projects })
    const actions: AppAction[] = []
    setActiveDispatch((action) => actions.push(action))
    setActiveSideEffectRunner(() => {})

    const { captureCharFrame, mockMouse, renderOnce } = await testRender(
      <ProjectList contentWidth={20} />,
      { height: 20, width: 20 }
    )
    const settle = async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      await renderOnce()
    }
    await settle()
    const lines = captureCharFrame().split('\n')
    const rowOf = (name: string) => lines.findIndex((l) => l.includes(name))
    const headingY = rowOf('project-a')
    const lastRowY = rowOf('project-c') + 1
    expect(headingY).toBeGreaterThan(0)

    await mockMouse.pressDown(4, headingY)
    await settle()
    // Straight from the heading to the far end of the list: the pointer leaves
    // the one-line source row on the very first drag event, which is exactly
    // what used to strand the gesture on another row's capture.
    await mockMouse.emitMouseEvent('drag', 4, lastRowY)
    await settle()
    // The preview bar sits below the last row, in the gap the drop would use.
    expect(captureCharFrame().split('\n')[lastRowY + 1]).toContain('━━━')

    await mockMouse.release(4, lastRowY)
    await settle()
    expect(actions).toEqual([{ orderedIds: ['b', 'c', 'a'], type: 'reorder-projects' }])
    expect(captureCharFrame()).not.toContain('━━━')
  })

  test('a click on a heading switches project instead of reordering', async () => {
    const projects = [makeProject('a', 0), makeProject('b', 1)]
    appStore.setState({ currentProjectId: 'a', projects })
    const actions: AppAction[] = []
    const effects: unknown[] = []
    setActiveDispatch((action) => actions.push(action))
    setActiveSideEffectRunner((effect) => effects.push(effect))

    const { captureCharFrame, mockMouse, renderOnce } = await testRender(
      <ProjectList contentWidth={20} />,
      { height: 20, width: 20 }
    )
    await renderOnce()
    const headingY = captureCharFrame()
      .split('\n')
      .findIndex((l) => l.includes('project-b'))

    await mockMouse.click(4, headingY)
    await renderOnce()

    expect(actions).toEqual([])
    expect(effects).toEqual([{ index: 2, type: 'switch-project-by-index', workspaceId: 'b-ws' }])
  })
})
