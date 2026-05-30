import {
  setAutoCommitEnabled,
  setExternalEditorConfig,
  setMultiRepoConfig,
} from '@brimveyn/aimux-config'
import { connect } from 'node:net'

import { loadConfig } from '../config'
import { loadUserConfig } from '../config/loader'
import { logDebug } from '../debug/input-log'
import { getProfileName } from '../profile-paths'
import { createSessionBackend } from '../session-backend/bootstrap'
import {
  fetchLatestNpmVersion,
  getCurrentPackageVersion,
  isNewerVersion,
} from '../update/version-check'
import { launchShell } from './launch-shell'
import { createGuiRuntime } from './runtime'
import { serveGuiRuntime } from './transport'

const GUI_PORT = 7878

export async function runGui(): Promise<void> {
  // The GUI streams raw PTY bytes to a client-side xterm.js for pixel-perfect
  // rendering. The daemon now forwards a `tabBytes` event when a client opts
  // in via `setBytesEnabled` (`RemoteSessionBackend` does that automatically
  // when constructed with `streamBytes: true`). PTYs live in the shared
  // terminal-manager process and survive GUI restarts — same model as the
  // TUI, so switching between the two preserves all live sessions.
  //
  // `AIMUX_LOCAL_BACKEND=1` still forces the in-process backend for tests/dev
  // (honored by `createSessionBackend`); it is no longer the default.

  const resolvedConfig = await loadUserConfig()
  setAutoCommitEnabled(resolvedConfig.autoCommit.enabled)
  setMultiRepoConfig(resolvedConfig.multiRepo)
  setExternalEditorConfig(resolvedConfig.externalEditor)

  const backend = await createSessionBackend({ streamBytes: true })
  const isLocalBackend = process.env.AIMUX_LOCAL_BACKEND === '1'

  // Reap every PTY when the host goes away — but only in local-backend mode.
  // With the daemon, PTYs live in terminal-manager and must survive a GUI
  // exit so reopening the GUI (or the TUI) reattaches to the live state.
  // Calling disposeAll() against the daemon would tear every session down,
  // which is exactly the behaviour this rework is meant to eliminate.
  let backendDisposed = false
  const disposeBackend = (): void => {
    if (backendDisposed) {
      return
    }
    backendDisposed = true
    if (isLocalBackend) {
      backend.disposeAll()
    }
  }

  const runtime = await createGuiRuntime({ backend, resolvedConfig })

  let updateCheckCancelled = false
  let shuttingDown = false
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    logDebug('gui.host.shutdown', { signal })
    updateCheckCancelled = true
    await runtime.dispose()
    disposeBackend()
    try {
      // Hard timeout so a hung IPC peer doesn't keep us from exiting; the
      // 200ms window is enough for a clean FIN on the daemon socket.
      await Promise.race([
        backend.destroy?.() ?? Promise.resolve(),
        new Promise((resolve) => setTimeout(resolve, 200)),
      ])
    } catch (error) {
      logDebug('gui.host.destroyFailed', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
    process.exit(0)
  }
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(sig, () => {
      void shutdown(sig)
    })
  }

  // Mirror the TUI's npm-version probe (src/app.tsx) so the GUI's already-
  // rendered UpdateAvailableModal pops when a newer version exists. Guards
  // match the TUI: env opt-out, dev profile, and the per-version skip the
  // user toggles from the modal itself.
  if (process.env.AIMUX_DISABLE_UPDATE_CHECK !== '1' && getProfileName() !== 'dev') {
    void (async () => {
      try {
        const [current, latest] = await Promise.all([
          getCurrentPackageVersion(),
          fetchLatestNpmVersion('@brimveyn/aimux'),
        ])
        if (updateCheckCancelled || !(latest != null && latest !== '')) return
        if (!isNewerVersion(latest, current)) return
        if (loadConfig().skippedUpdateVersion === latest) return
        logDebug('gui.host.updateAvailable', { current, latest })
        runtime.dispatch({
          currentVersion: current,
          latestVersion: latest,
          type: 'open-update-available-modal',
        })
      } catch (error) {
        // Best-effort: a registry hiccup or DNS failure must not crash the
        // host. React swallows the rejection in the TUI; the host has no
        // such safety net.
        logDebug('gui.host.updateCheckFailed', {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    })()
  }

  // Fail loudly if a stale GUI host still holds the port, instead of silently
  // leaving the browser talking to an old (version-skewed) host.
  const portOccupied = await new Promise<boolean>((resolve) => {
    const probe = connect(GUI_PORT, '127.0.0.1')
    probe.once('connect', () => {
      probe.destroy()
      resolve(true)
    })
    probe.once('error', () => resolve(false))
  })
  if (portOccupied) {
    process.stdout.write(
      `\n✖ aimux GUI: port ${GUI_PORT} is already in use (a previous host is still running).\n` +
        `  Kill it and retry:\n    lsof -ti tcp:${GUI_PORT} | xargs kill -9\n\n`
    )
    process.exit(1)
  }

  const transport = serveGuiRuntime({ backend, port: GUI_PORT, runtime })

  const url = `http://127.0.0.1:${transport.port}`
  process.stdout.write(`aimux gui host listening on ${url} (ws ${url}/ws)\n`)
  logDebug('gui.host.listening', { port: transport.port })

  const shell = await launchShell(transport.port)
  if (shell !== null) {
    await shell.exited
    await runtime.dispose()
    disposeBackend()
    await backend.destroy()
    transport.dispose()
    process.exit(0)
  }

  process.stdout.write(
    'Running GUI host without a window. Open the frontend yourself:\n' +
      '  Browser (HMR):  cd desktop && bun run dev   -> http://localhost:1420\n' +
      '  Native window:  cd desktop && bun run tauri build, then `bun run gui`\n'
  )
  await new Promise<never>(() => {})
}
