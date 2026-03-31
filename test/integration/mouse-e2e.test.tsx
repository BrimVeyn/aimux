import { createTestRenderer } from '@opentui/core/testing'
import { createRoot, useTerminalDimensions } from '@opentui/react'
import { afterEach, describe, test } from 'bun:test'
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { useEffect, useMemo, useRef, useState } from 'react'

import type { TerminalContentOrigin } from '../../src/input/raw-input-handler'
import type { TabSession, TerminalModeState, TerminalSnapshot } from '../../src/state/types'

import { encodeMouseEventForPty } from '../../src/input/mouse-forwarding'
import { parseCommand } from '../../src/pty/command-registry'
import { PtyManager } from '../../src/pty/pty-manager'
import { RootView } from '../../src/ui/root'

const TEST_WIDTH = 120
const TEST_HEIGHT = 40
const TEST_TAB_ID = 'tab-mouse'
const SIDEBAR_WIDTH = 28
const CONTENT_ORIGIN_X = 34
const CONTENT_ORIGIN_Y = 3
const TERMINAL_CLICK_X = 40
const TERMINAL_CLICK_Y = 10
const EXPECTED_PTY_X = TERMINAL_CLICK_X + 1 - CONTENT_ORIGIN_X
const EXPECTED_PTY_Y = TERMINAL_CLICK_Y + 1 - CONTENT_ORIGIN_Y

const INITIAL_TERMINAL_MODES: TerminalModeState = {
  mouseTrackingMode: 'none',
  sendFocusMode: false,
  alternateScrollMode: false,
  isAlternateBuffer: false,
  bracketedPasteMode: false,
}

const cleanups: Array<() => void> = []

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
  mouseForwardingEnabled,
  localScrollbackEnabled,
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
    const cols = Math.max(20, Math.floor(dimensions.width - SIDEBAR_WIDTH - 4))
    const rows = Math.max(1, Math.floor(dimensions.height - (2 + 4 + 4)))
    return { cols, rows }
  }, [dimensions.height, dimensions.width])

  const contentOriginRef = useRef<TerminalContentOrigin>({
    x: CONTENT_ORIGIN_X,
    y: CONTENT_ORIGIN_Y,
    cols: terminalSize.cols,
    rows: terminalSize.rows,
  })
  contentOriginRef.current = {
    x: CONTENT_ORIGIN_X,
    y: CONTENT_ORIGIN_Y,
    cols: terminalSize.cols,
    rows: terminalSize.rows,
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
    const { executable, args } = parseCommand(command)
    ptyManager.createSession({
      tabId: TEST_TAB_ID,
      command: executable,
      args,
      cols: terminalSize.cols,
      rows: terminalSize.rows,
      cwd: process.cwd(),
    })

    return () => {
      ptyManager.disposeAll()
    }
  }, [command, ptyManager, terminalSize.cols, terminalSize.rows])

  const tab: TabSession = {
    id: TEST_TAB_ID,
    assistant: 'claude',
    title: 'Fixture',
    status: 'running',
    activity: 'idle',
    buffer: '',
    viewport,
    terminalModes,
    command,
  }

  return (
    <RootView
      themeId="aimux"
      state={{
        tabs: [tab],
        activeTabId: TEST_TAB_ID,
        sessions: [],
        currentSessionId: null,
        snippets: [],
        focusMode: 'terminal-input',
        sidebar: {
          visible: true,
          width: SIDEBAR_WIDTH,
          minWidth: 18,
          maxWidth: 42,
        },
        modal: {
          type: null,
          selectedIndex: 0,
          editBuffer: null,
          sessionTargetId: null,
        },
        layout: {
          terminalCols: terminalSize.cols,
          terminalRows: terminalSize.rows,
        },
        customCommands: {
          claude: command,
          codex: 'codex',
          opencode: 'opencode',
        },
      }}
      contentOrigin={contentOriginRef.current}
      mouseForwardingEnabled={mouseForwardingEnabled}
      localScrollbackEnabled={localScrollbackEnabled}
      onTerminalMouseEvent={(event, origin) => {
        const sequence = encodeMouseEventForPty(event, origin)
        if (sequence) {
          ptyManager.write(TEST_TAB_ID, sequence)
        }
      }}
      onTerminalScrollEvent={(event) => {
        if (event.type !== 'scroll') {
          return
        }

        const direction = event.scroll?.direction
        if (direction === 'up') {
          ptyManager.scrollViewport(TEST_TAB_ID, -3)
        } else if (direction === 'down') {
          ptyManager.scrollViewport(TEST_TAB_ID, 3)
        }
      }}
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
  const { renderer, mockMouse, renderOnce, captureCharFrame } = await createTestRenderer({
    width: TEST_WIDTH,
    height: TEST_HEIGHT,
    useMouse: true,
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

describe('mouse passthrough integration', () => {
  test('forwards click events to the PTY in terminal-input mode', async () => {
    const app = await mountMouseHarness(createMouseFixtureCommand(), {
      mouseForwardingEnabled: true,
      localScrollbackEnabled: false,
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
      mouseForwardingEnabled: true,
      localScrollbackEnabled: false,
      readyText: 'READY',
    })

    await app.mockMouse.scroll(TERMINAL_CLICK_X, TERMINAL_CLICK_Y, 'up')

    await waitFor(
      app.renderOnce,
      () => app.captureCharFrame().includes(`[<64;${EXPECTED_PTY_X};${EXPECTED_PTY_Y}`),
      app.captureCharFrame
    )
  }, 15_000)

  test('uses local scrollback when mouse forwarding is disabled', async () => {
    const app = await mountMouseHarness(createScrollbackFixtureCommand(), {
      mouseForwardingEnabled: false,
      localScrollbackEnabled: true,
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
