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
import type { TabSession, TerminalModeState, TerminalSnapshot } from '../../src/state/types'

import { useMouseHandlers } from '../../src/app-runtime/use-mouse-handlers'
import { encodeMouseEventForPty } from '../../src/input/mouse-forwarding'
import { parseCommand } from '../../src/pty/command-registry'
import { PtyManager } from '../../src/pty/pty-manager'
import { appStore } from '../../src/state/app-store'
import { getGitPaneWidthFromRatio } from '../../src/state/git-pane-sizing'
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
      currentSessionId: null,
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
        embeddedRatio: 0.5,
        fileListMode: 'tree' as const,
        mode: 'embedded' as const,
        paneRatio: 0.5,
        path: { enabled: true },
        position: 'bottom' as const,
        prefetchRadius: 0,
        treeCompaction: false,
        visible: true,
      },
      layout: {
        terminalCols: terminalSize.cols,
        terminalRows: terminalSize.rows,
      },
      layoutTrees: {},
      modal: {
        editBuffer: null,
        selectedIndex: 0,
        sessionTargetId: null,
        type: null,
      },
      sessions: [],
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

function ResizeHarness({
  embeddedRatio = 0.5,
  gitPaneMode,
  gitPanePosition,
}: {
  gitPaneMode: 'embedded' | 'pane'
  gitPanePosition: 'top' | 'bottom' | 'left' | 'right'
  embeddedRatio?: number
}) {
  const [state, dispatch] = useReducer(appReducer, undefined, () => {
    const base = createInitialState()
    return {
      ...base,
      activeTabId: TEST_TAB_ID,
      focusMode: 'navigation' as const,
      gitPane: {
        ...base.gitPane,
        embeddedRatio,
        mode: gitPaneMode,
        position: gitPanePosition,
        visible: true,
      },
      sessionBar: { ...base.sessionBar, visible: false },
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
      onSidebarResizeStart={handlers.handleSidebarResizeStart}
      onGitPaneResizeStart={handlers.handleGitPaneResizeStart}
      onEmbeddedGitResizeStart={handlers.handleEmbeddedGitResizeStart}
      onSeparatorDragStart={handlers.handleSeparatorDragStart}
      onSeparatorDrag={handlers.handleSeparatorDrag}
      onSeparatorDragEnd={handlers.handleSeparatorDragEnd}
      terminalCols={80}
      terminalRows={24}
    />
  )
}

async function mountResizeHarness(options: {
  embeddedRatio?: number
  gitPaneMode: 'embedded' | 'pane'
  gitPanePosition: 'top' | 'bottom' | 'left' | 'right'
}) {
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
    () => {
      const gitPane = appStore.getState().gitPane
      return gitPane.mode === options.gitPaneMode && gitPane.position === options.gitPanePosition
    },
    () => JSON.stringify(appStore.getState().gitPane),
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

describe('mouse resize integration', () => {
  test('drags the sidebar edge to resize width', async () => {
    const app = await mountResizeHarness({ gitPaneMode: 'embedded', gitPanePosition: 'bottom' })
    const initialWidth = appStore.getState().sidebar.width

    let changed = false
    for (let x = initialWidth - 1; x <= initialWidth + 2 && !changed; x += 1) {
      for (let y = 4; y <= 20; y += 2) {
        await app.mockMouse.drag(x, y, x + 6, y)
        await app.renderOnce()
        if (appStore.getState().sidebar.width > initialWidth) {
          changed = true
          break
        }
      }
    }

    expect(changed).toBe(true)
    expect(appStore.getState().sidebar.width).toBeGreaterThan(initialWidth)
  })

  test('drags the side git pane edge to resize pane width', async () => {
    const app = await mountResizeHarness({ gitPaneMode: 'pane', gitPanePosition: 'left' })
    const initialRatio = appStore.getState().gitPane.paneRatio
    const paneWidth = getGitPaneWidthFromRatio(initialRatio)
    const startX = appStore.getState().sidebar.width + paneWidth

    let changed = false
    for (let x = startX - 1; x <= startX + 2; x += 1) {
      await app.mockMouse.drag(x, 8, x + 6, 8)
      await app.renderOnce()
      if (appStore.getState().gitPane.paneRatio > initialRatio) {
        changed = true
        break
      }
    }

    expect(changed).toBe(true)
    expect(appStore.getState().gitPane.paneRatio).toBeGreaterThan(initialRatio)
    expect(appStore.getState().gitPane.embeddedRatio).toBe(0.5)
  })

  test('drags the embedded git divider to resize height without changing sidebar width', async () => {
    const app = await mountResizeHarness({
      embeddedRatio: 0.5,
      gitPaneMode: 'embedded',
      gitPanePosition: 'bottom',
    })
    const initialRatio = appStore.getState().gitPane.embeddedRatio
    const initialSidebarWidth = appStore.getState().sidebar.width

    let changed = false
    for (let y = 8; y <= 28; y += 1) {
      await app.mockMouse.drag(8, y, 8, y + 4)
      await app.renderOnce()
      if (appStore.getState().gitPane.embeddedRatio !== initialRatio) {
        changed = true
        break
      }
    }

    expect(changed).toBe(true)
    expect(appStore.getState().gitPane.embeddedRatio).not.toBe(initialRatio)
    expect(appStore.getState().sidebar.width).toBe(initialSidebarWidth)
  })
})
