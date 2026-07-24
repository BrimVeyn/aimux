#!/usr/bin/env bun
import { runDaemon } from './daemon/daemon'
import { getRuntimeProfile } from './daemon/runtime-paths'
import { logDebug } from './debug/input-log'
import { runDoctor } from './doctor'
import { runRestartDaemon } from './restart-daemon'
import { runRestartTerminalManager } from './restart-terminal-manager'
import { createSessionBackend } from './session-backend/bootstrap'
import { runTerminalManager } from './terminal-manager/terminal-manager'
import { runUpdate } from './update'

const command = process.argv[2]
const runtimeProfile = getRuntimeProfile()

// CLI control plane (docs/reference/cli.md). Branch BEFORE the UI bootstrap so
// `aimux tab list` from a non-TTY shell never spins up the React renderer.
// Dynamic import keeps the CLI code out of the UI's cold-start cost.
const CLI_GROUPS = new Set(['tab', 'workspace', 'worktree', 'worker'])
if (typeof command === 'string' && CLI_GROUPS.has(command)) {
  const { runCli } = await import('./cli')
  process.exit(await runCli(process.argv.slice(2)))
}

if (command === '--version' || command === '-v' || command === 'version') {
  const { version } = await import('../package.json')
  process.stdout.write(`aimux ${version}\n`)
  process.exit(0)
}

if (command === 'doctor' || command === '--doctor') {
  process.exit(runDoctor())
}

if (command === 'restart-daemon') {
  process.exit(await runRestartDaemon())
}

if (command === 'restart-terminal-manager') {
  process.exit(await runRestartTerminalManager())
}

if (command === 'update') {
  process.exit(await runUpdate())
}

if (command === 'daemon') {
  logDebug('index.daemonMode', { runtimeProfile })
  await runDaemon()
}

if (command === 'terminal-manager') {
  logDebug('index.terminalManagerMode', { runtimeProfile })
  await runTerminalManager()
}

if (command === '--help' || command === '-h' || command === 'help') {
  const { runCli } = await import('./cli')
  process.exit(await runCli([]))
}

const [
  { createCliRenderer },
  { createRoot },
  { App },
  { loadUserConfig },
  { BreakingUpdateScreen },
  { setHostPalette },
] = await Promise.all([
  import('@opentui/core'),
  import('@opentui/react'),
  import('./app'),
  import('./config/loader'),
  import('./ui/breaking-update-screen'),
  import('./ui/host-palette'),
])
const resolvedConfig = await loadUserConfig()

const renderer = await createCliRenderer({
  autoFocus: true,
  // Transparent clear color so cells untouched by BoxRenderable paints (e.g.
  // when transparent mode overrides all chrome bg tokens to alpha=0) flush to
  // the terminal with no bg, letting the host terminal's background show
  // through. With an opaque clear color, transparent mode is a no-op.
  backgroundColor: '#00000000',
  consoleMode: 'disabled',
  exitOnCtrlC: false,
  screenMode: 'alternate-screen',
  useMouse: true,
})

// Query the host terminal's actual ANSI palette (OSC 4) so PTY cells that
// emit indexed colors render with the user's configured terminal theme
// instead of hardcoded xterm defaults. Best-effort: terminals that don't
// respond keep the fallback xterm palette.
try {
  const { palette } = await renderer.getPalette({ size: 256, timeout: 200 })
  setHostPalette(palette)
} catch (error) {
  logDebug('index.paletteDetectFailed', {
    message: error instanceof Error ? error.message : String(error),
  })
}

const root = createRoot(renderer)

logDebug('index.userConfigLoaded', {
  leader: resolvedConfig.keymaps.leader,
  modeCount: resolvedConfig.keymaps.modes.size,
})

// Beta — when experimental syntax highlight is on, ask Claude Code to emit
// plain code so we can re-tokenize on the snapshot. Set on process.env
// before backend bootstrap so the spawned daemon (and its child PTYs)
// inherit it.
if (resolvedConfig.theme?.beta?.experimentalSyntaxHighlight === true) {
  process.env.CLAUDE_CODE_SYNTAX_HIGHLIGHT = 'false'
}

const backend = await createSessionBackend({
  autoRenameConfig: resolvedConfig.autoRename,
  onBreakingUpdateRequired: () =>
    new Promise<void>((resolve) => {
      root.render(<BreakingUpdateScreen onConfirm={resolve} />)
    }),
})
logDebug('index.backendReady', { backend: backend.constructor.name, runtimeProfile })

root.render(<App backend={backend} resolvedConfig={resolvedConfig} />)
