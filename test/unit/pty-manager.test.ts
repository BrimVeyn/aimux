import { describe, expect, test } from 'bun:test'

import { PtyManager } from '../../src/pty/pty-manager'

describe('PtyManager', () => {
  test('spawns a command through Bun.Terminal and renders output', async () => {
    const manager = new PtyManager()
    let latestBuffer = ''

    const exitCode = await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timed out waiting for PTY session'))
      }, 5_000)

      manager.on('render', (_tabId, viewport) => {
        latestBuffer = viewport.lines
          .map((line) => line.spans.map((span) => span.text).join(''))
          .join('\n')
      })

      manager.on('error', (_tabId, message) => {
        clearTimeout(timeout)
        reject(new Error(message))
      })

      manager.on('exit', (_tabId, code) => {
        clearTimeout(timeout)
        resolve(code)
      })

      manager.createSession({
        tabId: 'tab-1',
        command: 'pwd',
        cols: 80,
        rows: 24,
        cwd: process.cwd(),
      })
    })

    expect(exitCode).toBe(0)
    expect(latestBuffer).toContain(process.cwd())
    manager.disposeAll()
  })

  test('does not emit duplicate renders for unchanged snapshots', async () => {
    const manager = new PtyManager()
    let renderCount = 0

    const exitCode = await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timed out waiting for PTY session'))
      }, 5_000)

      manager.on('render', () => {
        renderCount += 1
      })

      manager.on('error', (_tabId, message) => {
        clearTimeout(timeout)
        reject(new Error(message))
      })

      manager.on('exit', (_tabId, code) => {
        clearTimeout(timeout)
        resolve(code)
      })

      manager.createSession({
        tabId: 'tab-2',
        command: '/bin/sh',
        cols: 80,
        rows: 24,
        cwd: process.cwd(),
      })

      setTimeout(() => {
        manager.write('tab-2', "printf 'hello'; printf '\\r'; printf '\\r'; exit\r")
      }, 50)
    })

    expect(exitCode).toBe(0)
    expect(renderCount).toBeGreaterThan(0)
    expect(renderCount).toBeLessThanOrEqual(8)
    manager.disposeAll()
  })

  test('tracks mouse and focus modes from terminal output', async () => {
    const manager = new PtyManager()
    const seenModes: Array<{
      mouseTrackingMode: string
      sendFocusMode: boolean
      alternateScrollMode: boolean
      isAlternateBuffer: boolean
      bracketedPasteMode: boolean
    }> = []

    const exitCode = await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timed out waiting for PTY session'))
      }, 5_000)

      manager.on('render', (_tabId, _viewport, terminalModes) => {
        seenModes.push(terminalModes)
      })

      manager.on('error', (_tabId, message) => {
        clearTimeout(timeout)
        reject(new Error(message))
      })

      manager.on('exit', (_tabId, code) => {
        clearTimeout(timeout)
        resolve(code)
      })

      manager.createSession({
        tabId: 'tab-3',
        command: '/bin/sh',
        cols: 80,
        rows: 24,
        cwd: process.cwd(),
      })

      setTimeout(() => {
        manager.write('tab-3', "printf '\\033[?1002h\\033[?1004h\\033[?1007h'; exit\r")
      }, 50)
    })

    expect(exitCode).toBe(0)
    expect(seenModes).toContainEqual({
      mouseTrackingMode: 'none',
      sendFocusMode: false,
      alternateScrollMode: false,
      isAlternateBuffer: false,
      bracketedPasteMode: false,
    })
    expect(seenModes).toContainEqual({
      mouseTrackingMode: 'drag',
      sendFocusMode: true,
      alternateScrollMode: true,
      isAlternateBuffer: false,
      bracketedPasteMode: false,
    })
    manager.disposeAll()
  })

  test('tracks alternate scroll mode across split PTY output', async () => {
    const manager = new PtyManager()
    const seenModes: Array<boolean> = []

    const exitCode = await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timed out waiting for PTY session'))
      }, 5_000)

      manager.on('render', (_tabId, _viewport, terminalModes) => {
        seenModes.push(terminalModes.alternateScrollMode)
      })

      manager.on('error', (_tabId, message) => {
        clearTimeout(timeout)
        reject(new Error(message))
      })

      manager.on('exit', (_tabId, code) => {
        clearTimeout(timeout)
        resolve(code)
      })

      manager.createSession({
        tabId: 'tab-4',
        command: '/bin/sh',
        cols: 80,
        rows: 24,
        cwd: process.cwd(),
      })

      setTimeout(() => {
        manager.write(
          'tab-4',
          "printf '\\033[?10'; sleep 0.05; printf '07h'; sleep 0.05; printf '\\033[?1007l'; exit\r"
        )
      }, 50)
    })

    expect(exitCode).toBe(0)
    expect(seenModes).toContain(true)
    expect(seenModes[seenModes.length - 1]).toBe(false)
    manager.disposeAll()
  })

  test('tracks alternate scroll mode in bundled private-mode sequences', async () => {
    const manager = new PtyManager()
    const seenModes: Array<boolean> = []

    const exitCode = await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timed out waiting for PTY session'))
      }, 5_000)

      manager.on('render', (_tabId, _viewport, terminalModes) => {
        seenModes.push(terminalModes.alternateScrollMode)
      })

      manager.on('error', (_tabId, message) => {
        clearTimeout(timeout)
        reject(new Error(message))
      })

      manager.on('exit', (_tabId, code) => {
        clearTimeout(timeout)
        resolve(code)
      })

      manager.createSession({
        tabId: 'tab-5',
        command: '/bin/sh',
        cols: 80,
        rows: 24,
        cwd: process.cwd(),
      })

      setTimeout(() => {
        manager.write(
          'tab-5',
          "printf '\\033[?1002;1007h'; sleep 0.05; printf '\\033[?1000;1007l'; exit\r"
        )
      }, 50)
    })

    expect(exitCode).toBe(0)
    expect(seenModes).toContain(true)
    expect(seenModes[seenModes.length - 1]).toBe(false)
    manager.disposeAll()
  })

  test('tracks cursor visibility from terminal output', async () => {
    const manager = new PtyManager()
    const seenCursorStates: boolean[] = []

    const exitCode = await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timed out waiting for PTY session'))
      }, 5_000)

      manager.on('render', (tabId, viewport) => {
        if (tabId !== 'tab-cursor') {
          return
        }

        seenCursorStates.push(viewport.cursorVisible)
      })

      manager.on('error', (_tabId, message) => {
        clearTimeout(timeout)
        reject(new Error(message))
      })

      manager.on('exit', (_tabId, code) => {
        clearTimeout(timeout)
        resolve(code)
      })

      manager.createSession({
        tabId: 'tab-cursor',
        command: '/bin/sh',
        cols: 80,
        rows: 24,
        cwd: process.cwd(),
      })

      setTimeout(() => {
        manager.write('tab-cursor', "printf '\\033[?25l'; sleep 0.05; printf '\\033[?25h'; exit\r")
      }, 50)
    })

    expect(exitCode).toBe(0)
    expect(seenCursorStates).toContain(true)
    expect(seenCursorStates).toContain(false)
    expect(seenCursorStates[seenCursorStates.length - 1]).toBe(true)
    manager.disposeAll()
  })

  test('tracks bracketed paste mode from terminal output', async () => {
    const manager = new PtyManager()
    const seenModes: boolean[] = []

    const exitCode = await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timed out waiting for PTY session'))
      }, 5_000)

      manager.on('render', (tabId, _viewport, terminalModes) => {
        if (tabId !== 'tab-paste') {
          return
        }

        seenModes.push(terminalModes.bracketedPasteMode)
      })

      manager.on('error', (_tabId, message) => {
        clearTimeout(timeout)
        reject(new Error(message))
      })

      manager.on('exit', (_tabId, code) => {
        clearTimeout(timeout)
        resolve(code)
      })

      manager.createSession({
        tabId: 'tab-paste',
        command: '/bin/sh',
        cols: 80,
        rows: 24,
        cwd: process.cwd(),
      })

      setTimeout(() => {
        manager.write(
          'tab-paste',
          "printf '\\033[?2004h'; sleep 0.05; printf '\\033[?2004l'; exit\r"
        )
      }, 50)
    })

    expect(exitCode).toBe(0)
    expect(seenModes).toContain(true)
    expect(seenModes[seenModes.length - 1]).toBe(false)
    manager.disposeAll()
  })

  test('scrollViewport exposes scrollback history', async () => {
    const manager = new PtyManager()
    let latestViewportText = ''
    let latestViewportY = 0

    manager.on('render', (tabId, viewport) => {
      if (tabId !== 'tab-6') {
        return
      }

      latestViewportText = viewport.lines
        .map((line) => line.spans.map((span) => span.text).join(''))
        .join('\n')
      latestViewportY = viewport.viewportY
    })

    manager.createSession({
      tabId: 'tab-6',
      command: '/bin/sh',
      cols: 80,
      rows: 8,
      cwd: process.cwd(),
    })

    await new Promise<void>((resolve) => setTimeout(resolve, 50))
    manager.write('tab-6', 'for i in $(seq 1 20); do printf "line-$i\\r\\n"; done\r')
    await new Promise<void>((resolve) => setTimeout(resolve, 150))

    const atBottomViewportY = latestViewportY
    manager.scrollViewport('tab-6', -3)
    await new Promise<void>((resolve) => setTimeout(resolve, 20))

    expect(latestViewportY).toBeLessThan(atBottomViewportY)
    expect(latestViewportText).toContain('line-11')

    manager.scrollViewportToBottom('tab-6')
    await new Promise<void>((resolve) => setTimeout(resolve, 20))
    expect(latestViewportY).toBeGreaterThanOrEqual(atBottomViewportY)

    manager.disposeAll()
  })
})
