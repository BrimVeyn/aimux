import { describe, expect, test } from 'bun:test'

import { PtyManager } from '../../src/pty/pty-manager'

/**
 * The CPR round-trip below reads a reply that has no trailing newline, which
 * needs `read -d`/`-t` — bash builtins. `/bin/sh` is bash on macOS but dash on
 * most Linux distros, where the snippet fails with "read: Illegal option -d"
 * and the test would report a wiring bug that isn't there. Resolve bash
 * explicitly and skip if the machine has none.
 */
const BASH = Bun.which('bash')

/**
 * There is no test here for a command that exits the instant it starts.
 *
 * There was one — `pwd`, asserting on its exit code and then on its rendered
 * output. Both dropped: on Linux the `onExit` callback never arrives, and on
 * macOS both it and the final render go missing under a loaded suite, about one
 * run in twelve. Reproduced against `Bun.Terminal` with `PtyManager` out of the
 * picture, so it is the runtime, not this repo.
 *
 * Nothing was lost by removing it. `PtyManager` hands the command string
 * straight to `Bun.Terminal`; `pwd` and `/bin/sh` differ only in how long they
 * live, and every test below spawns a process and asserts on what it rendered.
 * The one claim that test made alone was about the runtime's behaviour with a
 * fast-exiting child, which is the thing that does not work.
 *
 * The blast radius in the app is narrow: tabs run assistants and shells, which
 * are long-lived. A one-shot custom command would sit at "running".
 *
 * ponytail: put it back when a Bun release delivers the callback.
 */

describe('PtyManager', () => {
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
        cols: 80,
        command: '/bin/sh',
        cwd: process.cwd(),
        rows: 24,
        tabId: 'tab-2',
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
    const seenModes: {
      mouseTrackingMode: string
      sendFocusMode: boolean
      alternateScrollMode: boolean
      isAlternateBuffer: boolean
      bracketedPasteMode: boolean
    }[] = []

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
        cols: 80,
        command: '/bin/sh',
        cwd: process.cwd(),
        rows: 24,
        tabId: 'tab-3',
      })

      setTimeout(() => {
        manager.write('tab-3', "printf '\\033[?1002h\\033[?1004h\\033[?1007h'; exit\r")
      }, 50)
    })

    expect(exitCode).toBe(0)
    expect(seenModes).toContainEqual({
      alternateScrollMode: false,
      bracketedPasteMode: false,
      isAlternateBuffer: false,
      mouseTrackingMode: 'none',
      sendFocusMode: false,
    })
    expect(seenModes).toContainEqual({
      alternateScrollMode: true,
      bracketedPasteMode: false,
      isAlternateBuffer: false,
      mouseTrackingMode: 'drag',
      sendFocusMode: true,
    })
    manager.disposeAll()
  })

  test('tracks alternate scroll mode across split PTY output', async () => {
    const manager = new PtyManager()
    const seenModes: boolean[] = []

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
        cols: 80,
        command: '/bin/sh',
        cwd: process.cwd(),
        rows: 24,
        tabId: 'tab-4',
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
    expect(seenModes.at(-1)).toBe(false)
    manager.disposeAll()
  })

  test('tracks alternate scroll mode in bundled private-mode sequences', async () => {
    const manager = new PtyManager()
    const seenModes: boolean[] = []

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
        cols: 80,
        command: '/bin/sh',
        cwd: process.cwd(),
        rows: 24,
        tabId: 'tab-5',
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
    expect(seenModes.at(-1)).toBe(false)
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
        cols: 80,
        command: '/bin/sh',
        cwd: process.cwd(),
        rows: 24,
        tabId: 'tab-cursor',
      })

      setTimeout(() => {
        manager.write('tab-cursor', "printf '\\033[?25l'; sleep 0.05; printf '\\033[?25h'; exit\r")
      }, 50)
    })

    expect(exitCode).toBe(0)
    expect(seenCursorStates).toContain(true)
    expect(seenCursorStates).toContain(false)
    expect(seenCursorStates.at(-1)).toBe(true)
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
        cols: 80,
        command: '/bin/sh',
        cwd: process.cwd(),
        rows: 24,
        tabId: 'tab-paste',
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
    expect(seenModes.at(-1)).toBe(false)
    manager.disposeAll()
  })

  test.skipIf(BASH === null)(
    'forwards emulator query replies back to the pty (CPR round-trip)',
    async () => {
      const manager = new PtyManager()
      let latestBuffer = ''

      const exitCode = await new Promise<number>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Timed out waiting for PTY session'))
        }, 5_000)

        manager.on('render', (tabId, viewport) => {
          if (tabId !== 'tab-cpr') return
          latestBuffer = viewport.lines
            .map((line) => line.spans.map((span) => span.text).join(''))
            .join('\n')
        })

        manager.on('error', (_tabId, message) => {
          clearTimeout(timeout)
          reject(new Error(message))
        })

        manager.on('exit', (tabId, code) => {
          if (tabId !== 'tab-cpr') return
          clearTimeout(timeout)
          resolve(code)
        })

        manager.createSession({
          cols: 80,
          command: BASH ?? '/bin/bash',
          cwd: process.cwd(),
          rows: 24,
          tabId: 'tab-cpr',
        })

        // Ask for a Cursor Position Report (ESC[6n) and read the reply off our
        // own stdin. It only arrives if the emulator's reply channel is wired
        // back to the pty. The result is emitted as `>>OK<<` / `>>NO<<` — those
        // exact strings only appear in the command's OUTPUT, never in the
        // echoed command line (which holds `r=OK` / `r=NO` / `>>%s<<`), so the
        // assertion can't be fooled by the shell echoing what we typed.
        setTimeout(() => {
          manager.write(
            'tab-cpr',
            "stty -echo; printf '\\033[6n'; IFS= read -r -d R -t 2 c && r=OK || r=NO; printf '\\n>>%s<<\\n' \"$r\"; exit\r"
          )
        }, 50)
      })

      expect(exitCode).toBe(0)
      expect(latestBuffer).toContain('>>OK<<')
      expect(latestBuffer).not.toContain('>>NO<<')
      manager.disposeAll()
    }
  )

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
      cols: 80,
      command: '/bin/sh',
      cwd: process.cwd(),
      rows: 8,
      tabId: 'tab-6',
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

  test('resize re-anchors from the emulator state after reflow', async () => {
    const manager = new PtyManager()
    let latestViewportY = 0
    let latestBaseY = 0
    let latestText = ''

    manager.on('render', (tabId, viewport) => {
      if (tabId !== 'tab-intent') {
        return
      }
      latestViewportY = viewport.viewportY
      latestBaseY = viewport.baseY
      latestText = viewport.lines
        .map((line) => line.spans.map((span) => span.text).join(''))
        .join('\n')
    })

    manager.createSession({
      cols: 80,
      command: '/bin/sh',
      cwd: process.cwd(),
      rows: 8,
      tabId: 'tab-intent',
    })

    await new Promise<void>((resolve) => setTimeout(resolve, 50))
    manager.write('tab-intent', 'for i in $(seq 1 40); do printf "line-$i\\r\\n"; done\r')
    await new Promise<void>((resolve) => setTimeout(resolve, 200))

    manager.scrollViewport('tab-intent', -10)
    await new Promise<void>((resolve) => setTimeout(resolve, 20))
    const firstLineBeforeResize = (latestText.split('\n')[0] ?? '').trim()

    // The backend owns scroll: resize derives the re-anchor target from the
    // emulator's own (pre-reflow) position, so the scrolled-up view persists.
    manager.resizeAll(60, 8)
    await new Promise<void>((resolve) => setTimeout(resolve, 50))

    expect(latestViewportY).toBeLessThan(latestBaseY)
    expect(latestText).toContain(firstLineBeforeResize)

    // Once scrolled to the bottom, a resize keeps it pinned to the bottom.
    manager.scrollViewportToBottom('tab-intent')
    await new Promise<void>((resolve) => setTimeout(resolve, 20))
    manager.resizeAll(80, 8)
    await new Promise<void>((resolve) => setTimeout(resolve, 50))
    expect(latestViewportY).toBe(latestBaseY)

    manager.disposeAll()
  })

  test('setBroadcastEnabled(false) suppresses renders during streaming', async () => {
    const manager = new PtyManager()
    let renderCount = 0
    manager.on('render', () => {
      renderCount += 1
    })

    manager.setBroadcastEnabled(false)
    expect(manager.hasSessions()).toBe(false)

    const exitCode = await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timed out')), 5_000)
      manager.on('error', (_id, msg) => {
        clearTimeout(timeout)
        reject(new Error(msg))
      })
      manager.on('exit', (_id, code) => {
        clearTimeout(timeout)
        resolve(code)
      })
      manager.createSession({
        cols: 80,
        command: '/bin/sh',
        cwd: process.cwd(),
        rows: 24,
        tabId: 'tab-broadcast-off',
      })
      setTimeout(() => {
        manager.write('tab-broadcast-off', "printf 'hello\\nworld\\n'; exit\r")
      }, 50)
    })

    expect(exitCode).toBe(0)
    expect(renderCount).toBe(0)
    manager.disposeAll()
  })

  test('hasSessions reflects createSession / dispose lifecycle', async () => {
    const manager = new PtyManager()
    expect(manager.hasSessions()).toBe(false)

    const exitCode = await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timed out')), 5_000)
      manager.on('error', (_id, msg) => {
        clearTimeout(timeout)
        reject(new Error(msg))
      })
      manager.on('exit', (_id, code) => {
        clearTimeout(timeout)
        resolve(code)
      })
      manager.createSession({
        cols: 80,
        command: '/bin/sh',
        cwd: process.cwd(),
        rows: 24,
        tabId: 'tab-has-sessions',
      })
      expect(manager.hasSessions()).toBe(true)
      setTimeout(() => manager.write('tab-has-sessions', 'exit\r'), 50)
    })

    expect(exitCode).toBe(0)
    // After 'exit' event, the session is removed from the registry.
    expect(manager.hasSessions()).toBe(false)
    manager.disposeAll()
  })

  test('re-enabling broadcast flushes a fresh viewport per active session', async () => {
    const manager = new PtyManager()
    const renderViewports: string[] = []
    manager.on('render', (_id, viewport) => {
      renderViewports.push(
        viewport.lines.map((line) => line.spans.map((s) => s.text).join('')).join('\n')
      )
    })

    // Disable BEFORE the session is created so no renders fire while data flows.
    manager.setBroadcastEnabled(false)

    const exitCode = await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timed out')), 5_000)
      manager.on('error', (_id, msg) => {
        clearTimeout(timeout)
        reject(new Error(msg))
      })

      manager.createSession({
        cols: 80,
        command: '/bin/sh',
        cwd: process.cwd(),
        rows: 24,
        tabId: 'tab-flush',
      })

      // Stream some output while broadcast is off, then re-enable, then exit.
      setTimeout(() => {
        manager.write('tab-flush', "printf 'broadcast-off-marker'\r")
      }, 50)
      setTimeout(() => {
        expect(renderViewports.length).toBe(0)
        manager.setBroadcastEnabled(true)
      }, 200)
      setTimeout(() => {
        manager.write('tab-flush', 'exit\r')
      }, 300)

      manager.on('exit', (_id, code) => {
        clearTimeout(timeout)
        resolve(code)
      })
    })

    expect(exitCode).toBe(0)
    // Re-enable should have produced at least one render carrying the marker.
    expect(renderViewports.length).toBeGreaterThan(0)
    expect(renderViewports.some((text) => text.includes('broadcast-off-marker'))).toBe(true)
    manager.disposeAll()
  })
})
