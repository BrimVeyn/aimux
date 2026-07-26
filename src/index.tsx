#!/usr/bin/env bun
// Every branch below imports dynamically ON PURPOSE. Static imports here would
// be paid by every invocation — including `aimux __complete`, which runs on
// each TAB press and must stay well under a keystroke's worth of latency.
const command = process.argv[2]

// Shell completion. First branch and cheapest: it loads the CLI registry and
// nothing else — no daemon client, no session backend, no renderer.
if (command === '__complete') {
  const { runComplete } = await import('./cli/completion/entry')
  process.exit(await runComplete(process.argv.slice(3)))
}

if (command === 'completion') {
  const { runCompletion } = await import('./cli/completion/entry')
  process.exit(runCompletion(process.argv.slice(3)))
}

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
  const { runDoctor } = await import('./doctor')
  process.exit(runDoctor())
}

if (command === 'restart-daemon') {
  const { runRestartDaemon } = await import('./restart-daemon')
  process.exit(await runRestartDaemon())
}

if (command === 'restart-terminal-manager') {
  const { runRestartTerminalManager } = await import('./restart-terminal-manager')
  process.exit(await runRestartTerminalManager())
}

if (command === 'update') {
  const { runUpdate } = await import('./update')
  process.exit(await runUpdate())
}

const { logDebug } = await import('./debug/input-log')
const { getRuntimeProfile } = await import('./daemon/runtime-paths')
const runtimeProfile = getRuntimeProfile()

if (command === 'daemon') {
  logDebug('index.daemonMode', { runtimeProfile })
  const { runDaemon } = await import('./daemon/daemon')
  await runDaemon()
}

if (command === 'terminal-manager') {
  logDebug('index.terminalManagerMode', { runtimeProfile })
  const { runTerminalManager } = await import('./terminal-manager/terminal-manager')
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
  { createSessionBackend },
  { maybeAutoInstallCompletion },
] = await Promise.all([
  import('@opentui/core'),
  import('@opentui/react'),
  import('./app'),
  import('./config/loader'),
  import('./ui/breaking-update-screen'),
  import('./ui/host-palette'),
  import('./session-backend/bootstrap'),
  import('./cli/completion/install'),
])
const resolvedConfig = await loadUserConfig()

// First launch (and after every upgrade): drop the shell completion script in
// the conventional location for $SHELL. Silent and best-effort — it writes one
// file, never a dotfile, and never blocks the TUI. Opt out with
// AIMUX_NO_COMPLETION_INSTALL=1; `aimux doctor` reports what landed where.
maybeAutoInstallCompletion()

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
