import { createTestRenderer } from '@opentui/core/testing'
import { createRoot } from '@opentui/react'
import { afterEach, describe, expect, test } from 'bun:test'
import { useRef } from 'react'

import type { MeasuredPaneRect } from '../../src/app-runtime/use-pane-size-report'
import type { TerminalContentOrigin } from '../../src/input/raw-input-handler'
import type { SessionBackend } from '../../src/session-backend/types'
import type { AppState, TabSession, TerminalModeState } from '../../src/state/types'

import { useTerminalResize } from '../../src/app-runtime/use-terminal-resize'
import { appReducer, createInitialState } from '../../src/state/store'

const WIDTH = 120
const HEIGHT = 40
const BASE_TAB = 'tab-base'
const NEW_TAB = 'tab-split'

const MODES: TerminalModeState = {
  alternateScrollMode: false,
  bracketedPasteMode: false,
  isAlternateBuffer: false,
  mouseTrackingMode: 'none',
  sendFocusMode: false,
}

function makeTab(id: string): TabSession {
  return {
    activity: 'idle',
    assistant: 'claude',
    buffer: 'ready',
    command: 'claude',
    id,
    status: 'running',
    terminalModes: MODES,
    title: id,
  }
}

// No-op backend: useTerminalResize calls resizeTab/resizeAll on mount; we only
// assert the contentOriginRef side effect, not the backend traffic.
const BACKEND = new Proxy({}, { get: () => () => {} }) as unknown as SessionBackend

type MeasureFn = (tabId: string, rect: MeasuredPaneRect) => void

// Module-level bridge so the harness can hand the hook's outputs back to the
// test without inline-closure props (which the renderer would treat as fresh
// each frame). Reassigned per mount; tests run sequentially.
let bridgeMeasure: MeasureFn | null = null
let bridgeOriginRef: { current: TerminalContentOrigin } | null = null

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

function Harness({ state }: { state: AppState }) {
  const contentOriginRef = useRef<TerminalContentOrigin>({ cols: 0, rows: 0, x: 0, y: 0 })
  const resizingRef = useRef(false)
  const { onMeasure } = useTerminalResize({
    backend: BACKEND,
    contentOriginRef,
    dimensions: { height: HEIGHT, width: WIDTH },
    dispatch: () => {},
    resizingRef,
    state,
  })
  bridgeMeasure = onMeasure
  bridgeOriginRef = contentOriginRef
  return null
}

async function mount(state: AppState) {
  bridgeMeasure = null
  bridgeOriginRef = null
  const { renderer, renderOnce } = await createTestRenderer({
    height: HEIGHT,
    useMouse: false,
    width: WIDTH,
  })
  const root = createRoot(renderer)
  root.render(<Harness state={state} />)
  cleanups.push(() => root.unmount())
  const deadline = Date.now() + 5_000
  while ((bridgeMeasure === null || bridgeOriginRef === null) && Date.now() < deadline) {
    await renderOnce()
    await Bun.sleep(20)
  }
  // Cast on read: TS can't see the Harness closure assigning these module vars,
  // so it would narrow them to `null` and treat the success path as `never`.
  const measure = bridgeMeasure as MeasureFn | null
  const originRef = bridgeOriginRef as { current: TerminalContentOrigin } | null
  if (measure === null || originRef === null) {
    throw new Error('harness not wired')
  }
  return { measure, originRef }
}

function singlePaneState(): AppState {
  return { ...createInitialState(), activeTabId: BASE_TAB, tabs: [makeTab(BASE_TAB)] }
}

function splitState(): AppState {
  // Drive the real reducer so layoutTrees + tabGroupMap describe a true split;
  // the new tab becomes active, matching the live split flow.
  return appReducer(singlePaneState(), {
    direction: 'vertical',
    newTab: makeTab(NEW_TAB),
    type: 'split-pane',
  })
}

describe('useTerminalResize content origin', () => {
  test('single pane adopts the measured box as the area origin', async () => {
    const { measure, originRef } = await mount(singlePaneState())
    // A pane-relative box that differs from the model origin.
    measure(BASE_TAB, { cols: 60, rows: 24, x: 40, y: 6 })
    expect(originRef.current.x).toBe(40)
    expect(originRef.current.y).toBe(6)
  })

  test('split pane keeps the whole-area origin (no double-count offset)', async () => {
    const split = splitState()
    expect(split.activeTabId).toBe(NEW_TAB)
    const { measure, originRef } = await mount(split)
    // The model-derived whole-area origin set during render.
    const areaX = originRef.current.x
    const areaY = originRef.current.y
    // The active split pane reports its own pane-relative box (offset right by
    // half the width). Before the fix this was adopted as the area origin and
    // SplitLayout re-added the pane bounds, pushing the cursor off-axis.
    measure(NEW_TAB, { cols: 40, rows: 24, x: 82, y: 6 })
    expect(originRef.current.x).toBe(areaX)
    expect(originRef.current.y).toBe(areaY)
    expect(originRef.current.x).not.toBe(82)
  })
})
