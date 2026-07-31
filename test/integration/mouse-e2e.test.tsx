import type { MouseEvent as OtuiMouseEvent } from '@opentui/core'

import { createTestRenderer } from '@opentui/core/testing'
import { createRoot, useTerminalDimensions } from '@opentui/react'
import { afterEach, describe, expect, test } from 'bun:test'
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react'

import type { TerminalContentOrigin } from '../../src/input/raw-input-handler'
import type { SessionBackend } from '../../src/session-backend/types'
import type {
  BarsState,
  TabSession,
  TerminalModeState,
  TerminalSnapshot,
} from '../../src/state/types'

import { useMouseHandlers } from '../../src/app-runtime/use-mouse-handlers'
import { encodeMouseEventForPty } from '../../src/input/mouse-forwarding'
import { parseCommand } from '../../src/pty/command-registry'
import { PtyManager } from '../../src/pty/pty-manager'
import { appStore } from '../../src/state/app-store'
import { appReducer, createInitialState } from '../../src/state/store'
import { RootView } from '../../src/ui/root'

const NOOP = (): void => {}

const TEST_WIDTH = 120
const TEST_HEIGHT = 40
const TEST_TAB_ID = 'tab-mouse'
const SIDEBAR_WIDTH = 28
const SIDEBAR_MIN_WIDTH = 18
const SIDEBAR_MAX_WIDTH = 42
const CONTENT_ORIGIN_X = 34
const CONTENT_ORIGIN_Y = 3
// Keep the mouse target comfortably inside terminal content so renderer hit-testing
// does not depend on how empty space inside a row is assigned across platforms.
const TERMINAL_CLICK_X = CONTENT_ORIGIN_X + 2
const TERMINAL_CLICK_Y = CONTENT_ORIGIN_Y + 2
const MIN_TERMINAL_COLS = 20
const MIN_TERMINAL_ROWS = 1
const TERMINAL_HORIZONTAL_CHROME = 4
const TERMINAL_VERTICAL_CHROME = 10
const LOCAL_SCROLL_DELTA = 3
const EXPECTED_PTY_X = TERMINAL_CLICK_X + 1 - CONTENT_ORIGIN_X
const EXPECTED_PTY_Y = TERMINAL_CLICK_Y + 1 - CONTENT_ORIGIN_Y

const INITIAL_TERMINAL_MODES: TerminalModeState = {
  alternateScrollMode: false,
  bracketedPasteMode: false,
  isAlternateBuffer: false,
  mouseTrackingMode: 'none',
  sendFocusMode: false,
}

const cleanups: (() => void)[] = []

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.()
  }
})

function createMouseFixtureCommand(): string {
  const tempDir = mkdtempSync(join(tmpdir(), 'aimux-mouse-'))
  const commandPath = join(tempDir, 'aimux-mouse-fixture')
  writeFileSync(
    commandPath,
    [
      '#!/usr/bin/env bun',
      'const decoder = new TextDecoder();',
      'process.stdout.write("READY\\r\\n");',
      'for await (const chunk of Bun.stdin.stream()) {',
      '  process.stdout.write(`INPUT:${JSON.stringify(decoder.decode(chunk))}\\r\\n`);',
      '}',
      '',
    ].join('\n')
  )
  chmodSync(commandPath, 0o755)
  return commandPath
}

function createScrollbackFixtureCommand(): string {
  const tempDir = mkdtempSync(join(tmpdir(), 'aimux-scroll-'))
  const commandPath = join(tempDir, 'aimux-scrollback-fixture')
  writeFileSync(
    commandPath,
    [
      '#!/usr/bin/env bun',
      'for (let i = 1; i <= 40; i += 1) {',
      '  process.stdout.write(`line-${i}\\r\\n`);',
      '}',
      'setInterval(() => {}, 1000);',
      '',
    ].join('\n')
  )
  chmodSync(commandPath, 0o755)
  return commandPath
}

async function waitFor(
  renderOnce: () => Promise<void>,
  predicate: () => boolean,
  describeState: () => string,
  timeoutMs = 5_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await renderOnce()
    if (predicate()) {
      return
    }
    await Bun.sleep(20)
  }

  throw new Error(`Timed out waiting for integration condition\n${describeState()}`)
}

function MouseHarness({
  command,
  localScrollbackEnabled,
  mouseForwardingEnabled,
}: {
  command: string
  mouseForwardingEnabled: boolean
  localScrollbackEnabled: boolean
}) {
  const dimensions = useTerminalDimensions()
  const ptyManagerRef = useRef<PtyManager | null>(null)
  if (!ptyManagerRef.current) {
    ptyManagerRef.current = new PtyManager()
  }

  const ptyManager = ptyManagerRef.current
  const [viewport, setViewport] = useState<TerminalSnapshot>()
  const [terminalModes, setTerminalModes] = useState<TerminalModeState>(INITIAL_TERMINAL_MODES)

  const terminalSize = useMemo(() => {
    const cols = Math.max(
      MIN_TERMINAL_COLS,
      Math.floor(dimensions.width - SIDEBAR_WIDTH - TERMINAL_HORIZONTAL_CHROME)
    )
    const rows = Math.max(
      MIN_TERMINAL_ROWS,
      Math.floor(dimensions.height - TERMINAL_VERTICAL_CHROME)
    )
    return { cols, rows }
  }, [dimensions.height, dimensions.width])

  const contentOriginRef = useRef<TerminalContentOrigin>({
    cols: terminalSize.cols,
    rows: terminalSize.rows,
    x: CONTENT_ORIGIN_X,
    y: CONTENT_ORIGIN_Y,
  })
  contentOriginRef.current = {
    cols: terminalSize.cols,
    rows: terminalSize.rows,
    x: CONTENT_ORIGIN_X,
    y: CONTENT_ORIGIN_Y,
  }

  useEffect(() => {
    const handleRender = (
      tabId: string,
      nextViewport: TerminalSnapshot,
      nextModes: TerminalModeState
    ) => {
      if (tabId !== TEST_TAB_ID) {
        return
      }
      setViewport(nextViewport)
      setTerminalModes(nextModes)
    }

    ptyManager.on('render', handleRender)
    return () => {
      ptyManager.off('render', handleRender)
    }
  }, [ptyManager])

  useEffect(() => {
    const { args, executable } = parseCommand(command)
    ptyManager.createSession({
      args,
      cols: terminalSize.cols,
      command: executable,
      cwd: process.cwd(),
      rows: terminalSize.rows,
      tabId: TEST_TAB_ID,
    })

    return () => {
      ptyManager.disposeAll()
    }
  }, [command, ptyManager, terminalSize.cols, terminalSize.rows])

  const storeState = useMemo(
    () => ({
      activeTabId: TEST_TAB_ID,
      currentProjectId: null,
      customCommands: {
        antigravity: 'antigravity',
        claude: command,
        codex: 'codex',
        grok: 'grok',
        kimi: 'kimi',
        opencode: 'opencode',
        terminal: 'zsh',
      },
      focusMode: 'terminal-input' as const,
      gitPane: {
        diffCount: { enabled: true },
        diffModeRatio: 0.35,
        fileListMode: 'tree' as const,
        path: { enabled: true },
        prefetchRadius: 0,
        treeCompaction: false,
      },
      layout: {
        terminalCols: terminalSize.cols,
        terminalRows: terminalSize.rows,
      },
      layoutTrees: {},
      modal: {
        editBuffer: null,
        projectTargetId: null,
        selectedIndex: 0,
        type: null,
      },
      projects: [],
      sidebar: {
        maxWidth: SIDEBAR_MAX_WIDTH,
        minWidth: SIDEBAR_MIN_WIDTH,
        visible: true,
        width: SIDEBAR_WIDTH,
      },
      snippets: [],
      tabGroupMap: {},
      tabs: [
        {
          activity: 'idle',
          assistant: 'claude',
          buffer: '',
          command,
          id: TEST_TAB_ID,
          status: 'running',
          terminalModes,
          title: 'Fixture',
          viewport,
        } satisfies TabSession,
      ],
    }),
    [command, terminalModes, terminalSize.cols, terminalSize.rows, viewport]
  )

  useLayoutEffect(() => {
    appStore.setState(storeState)
  }, [storeState])

  const handleTerminalMouseEvent = useCallback(
    (event: OtuiMouseEvent, origin: TerminalContentOrigin) => {
      const sequence = encodeMouseEventForPty(event, origin)
      if (sequence != null && sequence !== '') {
        ptyManager.write(TEST_TAB_ID, sequence)
      }
    },
    [ptyManager]
  )
  const handleTerminalScrollEvent = useCallback(
    (event: OtuiMouseEvent) => {
      if (event.type !== 'scroll') {
        return
      }

      const direction = event.scroll?.direction
      if (direction === 'up') {
        ptyManager.scrollViewport(TEST_TAB_ID, -LOCAL_SCROLL_DELTA)
      } else if (direction === 'down') {
        ptyManager.scrollViewport(TEST_TAB_ID, LOCAL_SCROLL_DELTA)
      }
    },
    [ptyManager]
  )

  return (
    <RootView
      themeId="aimux-dark"
      contentOrigin={contentOriginRef.current}
      mouseForwardingEnabled={mouseForwardingEnabled}
      localScrollbackEnabled={localScrollbackEnabled}
      onTerminalMouseEvent={handleTerminalMouseEvent}
      terminalCols={terminalSize.cols}
      terminalRows={terminalSize.rows}
      onTerminalScrollEvent={handleTerminalScrollEvent}
    />
  )
}

async function mountMouseHarness(
  command: string,
  options: {
    mouseForwardingEnabled: boolean
    localScrollbackEnabled: boolean
    readyText?: string
  }
) {
  const { captureCharFrame, mockMouse, renderer, renderOnce } = await createTestRenderer({
    height: TEST_HEIGHT,
    useMouse: true,
    width: TEST_WIDTH,
  })
  const root = createRoot(renderer)
  root.render(
    <MouseHarness
      command={command}
      mouseForwardingEnabled={options.mouseForwardingEnabled}
      localScrollbackEnabled={options.localScrollbackEnabled}
    />
  )

  let cleanedUp = false
  const cleanup = () => {
    if (cleanedUp) {
      return
    }
    cleanedUp = true
    root.unmount()
  }
  cleanups.push(cleanup)

  const readyText = options.readyText ?? 'READY'
  await waitFor(renderOnce, () => captureCharFrame().includes(readyText), captureCharFrame, 8_000)

  return { captureCharFrame, cleanup, mockMouse, renderOnce }
}

const RESIZE_CONTENT_ORIGIN: TerminalContentOrigin = { cols: 80, rows: 24, x: 30, y: 2 }
const RESIZE_BACKEND = {
  scrollViewport() {},
  write() {},
} as unknown as SessionBackend
const RESIZE_RENDERER = {
  clearSelection() {},
  startSelection() {},
  updateSelection() {},
}

function ResizeHarness({ bars }: { bars: BarsState }) {
  const [state, dispatch] = useReducer(appReducer, undefined, () => {
    const base = createInitialState()
    return {
      ...base,
      activeTabId: TEST_TAB_ID,
      bars,
      focusMode: 'navigation' as const,
      projectBar: { ...base.projectBar, visible: false },
      tabs: [
        {
          activity: 'idle',
          assistant: 'claude',
          buffer: 'ready',
          command: 'claude',
          id: TEST_TAB_ID,
          status: 'running',
          terminalModes: INITIAL_TERMINAL_MODES,
          title: 'Resize target',
        } satisfies TabSession,
      ],
    }
  })

  const handlers = useMouseHandlers({
    activeLocalScrollbackEnabled: false,
    activeMouseForwardingEnabled: false,
    backend: RESIZE_BACKEND,
    dispatch,
    renderer: RESIZE_RENDERER,
    state,
  })

  useLayoutEffect(() => {
    appStore.setState({ ...state, dispatch })
  }, [dispatch, state])

  return (
    <RootView
      themeId="aimux-dark"
      contentOrigin={RESIZE_CONTENT_ORIGIN}
      mouseForwardingEnabled={false}
      localScrollbackEnabled={false}
      onTerminalMouseEvent={NOOP}
      onTerminalScrollEvent={NOOP}
      onTerminalClick={handlers.handleTerminalClick}
      onPaneActivate={handlers.handlePaneActivate}
      onSplitResize={handlers.handleSplitResize}
      onBarResizeStart={handlers.handleBarResizeStart}
      onBarBoundaryResizeStart={handlers.handleBarBoundaryResizeStart}
      onSeparatorDragStart={handlers.handleSeparatorDragStart}
      onSeparatorDrag={handlers.handleSeparatorDrag}
      onSeparatorDragEnd={handlers.handleSeparatorDragEnd}
      terminalCols={80}
      terminalRows={24}
    />
  )
}

async function mountResizeHarness(options: { bars: BarsState }) {
  const { mockMouse, renderer, renderOnce } = await createTestRenderer({
    height: TEST_HEIGHT,
    useMouse: true,
    width: TEST_WIDTH,
  })
  const root = createRoot(renderer)
  root.render(<ResizeHarness {...options} />)

  let cleanedUp = false
  const cleanup = () => {
    if (cleanedUp) return
    cleanedUp = true
    root.unmount()
  }
  cleanups.push(cleanup)

  await renderOnce()
  await renderOnce()
  await waitFor(
    renderOnce,
    () => JSON.stringify(appStore.getState().bars) === JSON.stringify(options.bars),
    () => JSON.stringify(appStore.getState().bars),
    1_000
  )

  return { cleanup, mockMouse, renderOnce }
}

describe('mouse passthrough integration', () => {
  test('forwards click events to the PTY in terminal-input mode', async () => {
    const app = await mountMouseHarness(createMouseFixtureCommand(), {
      localScrollbackEnabled: false,
      mouseForwardingEnabled: true,
      readyText: 'READY',
    })

    await app.mockMouse.click(TERMINAL_CLICK_X, TERMINAL_CLICK_Y)

    await waitFor(
      app.renderOnce,
      () => {
        const frame = app.captureCharFrame()
        return (
          frame.includes(`[<0;${EXPECTED_PTY_X};${EXPECTED_PTY_Y}M`) &&
          frame.includes(`[<3;${EXPECTED_PTY_X};${EXPECTED_PTY_Y}`)
        )
      },
      app.captureCharFrame
    )
  }, 15_000)

  test('forwards scroll events to the PTY in terminal-input mode', async () => {
    const app = await mountMouseHarness(createMouseFixtureCommand(), {
      localScrollbackEnabled: false,
      mouseForwardingEnabled: true,
      readyText: 'READY',
    })

    const expected = `[<64;${EXPECTED_PTY_X};${EXPECTED_PTY_Y}`
    await waitFor(
      async () => {
        await app.mockMouse.scroll(TERMINAL_CLICK_X, TERMINAL_CLICK_Y, 'up')
        await app.renderOnce()
      },
      () => app.captureCharFrame().includes(expected),
      app.captureCharFrame
    )
  }, 15_000)

  test('uses local scrollback when mouse forwarding is disabled', async () => {
    const app = await mountMouseHarness(createScrollbackFixtureCommand(), {
      localScrollbackEnabled: true,
      mouseForwardingEnabled: false,
      readyText: 'line-40',
    })
    await app.mockMouse.scroll(TERMINAL_CLICK_X, TERMINAL_CLICK_Y, 'up')
    await app.mockMouse.scroll(TERMINAL_CLICK_X, TERMINAL_CLICK_Y, 'up')

    await waitFor(
      app.renderOnce,
      () => {
        const frame = app.captureCharFrame()
        return frame.includes('line-6') && !frame.includes('line-40')
      },
      app.captureCharFrame
    )
  }, 15_000)
})

const LEFT_ONLY_BARS: BarsState = {
  left: {
    visible: true,
    widgets: [
      { grow: 50, id: 'workspaces', visible: true },
      { grow: 50, id: 'git', visible: true },
    ],
    width: 28,
  },
  right: { visible: false, widgets: [], width: 40 },
}

const BOTH_BARS: BarsState = {
  left: { visible: true, widgets: [{ grow: 100, id: 'workspaces', visible: true }], width: 28 },
  right: { visible: true, widgets: [{ grow: 100, id: 'git', visible: true }], width: 30 },
}

describe('mouse resize integration', () => {
  test('drags the left bar edge to resize width', async () => {
    const app = await mountResizeHarness({ bars: LEFT_ONLY_BARS })
    const initialWidth = appStore.getState().bars.left.width

    let changed = false
    for (let x = initialWidth - 1; x <= initialWidth + 2 && !changed; x += 1) {
      for (let y = 4; y <= 20; y += 2) {
        await app.mockMouse.drag(x, y, x + 6, y)
        await app.renderOnce()
        if (appStore.getState().bars.left.width > initialWidth) {
          changed = true
          break
        }
      }
    }

    expect(changed).toBe(true)
    expect(appStore.getState().bars.left.width).toBeGreaterThan(initialWidth)
  })

  test('drags the right bar edge leftwards to widen it', async () => {
    const app = await mountResizeHarness({ bars: BOTH_BARS })
    const initialWidth = appStore.getState().bars.right.width
    const edgeX = TEST_WIDTH - initialWidth

    // The exact edge column shifts a little with the surrounding layout, so
    // sweep a few columns around it rather than pinning one coordinate.
    let changed = false
    for (let x = edgeX - 1; x <= edgeX + 6 && !changed; x += 1) {
      await app.mockMouse.drag(x, 8, x - 6, 8)
      await app.renderOnce()
      changed = appStore.getState().bars.right.width > initialWidth
    }

    expect(changed).toBe(true)
    expect(appStore.getState().bars.right.width).toBeGreaterThan(initialWidth)
    expect(appStore.getState().bars.left.width).toBe(BOTH_BARS.left.width)
  })

  test('drags the widget boundary to redistribute grow without changing bar width', async () => {
    const app = await mountResizeHarness({ bars: LEFT_ONLY_BARS })
    const initialGrows = appStore.getState().bars.left.widgets.map((w) => w.grow)
    const initialWidth = appStore.getState().bars.left.width

    let changed = false
    for (let y = 8; y <= 28; y += 1) {
      await app.mockMouse.drag(8, y, 8, y + 4)
      await app.renderOnce()
      const grows = appStore.getState().bars.left.widgets.map((w) => w.grow)
      if (grows.join() !== initialGrows.join()) {
        changed = true
        break
      }
    }

    expect(changed).toBe(true)
    const grows = appStore.getState().bars.left.widgets.map((w) => w.grow)
    expect(grows.reduce((a, b) => a + b, 0)).toBe(initialGrows.reduce((a, b) => a + b, 0))
    expect(appStore.getState().bars.left.width).toBe(initialWidth)
  })
})
