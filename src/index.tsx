#!/usr/bin/env bun
import { createCliRenderer } from '@opentui/core'
import { createRoot } from '@opentui/react'

import { App } from './app'
import { loadUserConfig } from './config/loader'
import { runDaemon } from './daemon/daemon'
import { getRuntimeProfile } from './daemon/runtime-paths'
import { logDebug } from './debug/input-log'
import { runDoctor } from './doctor'
import { runRestartDaemon } from './restart-daemon'
import { runRestartTerminalManager } from './restart-terminal-manager'
import { createSessionBackend } from './session-backend/bootstrap'
import { runTerminalManager } from './terminal-manager/terminal-manager'
import { BreakingUpdateScreen } from './ui/breaking-update-screen'
import { setHostPalette } from './ui/host-palette'
import { runUpdate } from './update'

const command = process.argv[2]
const runtimeProfile = getRuntimeProfile()

// CLI control plane (docs/reference/cli.md). Branch BEFORE the UI bootstrap so
// `aimux tab list` from a non-TTY shell never spins up the React renderer.
// Dynamic import keeps the CLI code out of the UI's cold-start cost.
const CLI_GROUPS = new Set(['tab', 'workspace', 'worktree'])
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
  process.stdout.write(
    [
      'aimux — terminal multiplexer for AI CLIs',
      '',
      'Two surfaces:',
      '  • Interactive TUI (no args): drive assistants side-by-side in one window.',
      '  • CLI control plane (`aimux <group> <verb>`): script-friendly, JSON output,',
      '    designed to be driven by another agent or a shell pipeline.',
      '',
      'Interactive',
      '  aimux                             Start the TUI in the current profile',
      '',
      'CLI control plane (JSON on stdout, human-readable errors on stderr)',
      '  aimux tab       list | create | send | focus | close | snapshot | tail | wait',
      '  aimux workspace list | show | create | switch | close',
      '  aimux worktree  list | create | remove',
      '',
      '  aimux <group> --help              List verbs in that group',
      '  aimux <group> <verb> --help       Show flags, args, and exit codes',
      '',
      'Common CLI verbs at a glance',
      '  aimux tab list                                     Enumerate tabs (+ activeTabId)',
      '  aimux tab create --assistant <id> [--title …]      Spawn claude / codex / opencode / grok / terminal / …',
      '  aimux tab send <tabId> [text] [--enter|--keys|--stdin]  Type, chord, or paste into a tab',
      '  aimux tab focus <tabId>                            Bring a tab to the foreground',
      '  aimux tab close <tabId>                            Terminate a tab',
      '  aimux tab snapshot <tabId> [--tail N] [--format …] Capture the screen (json | text)',
      '  aimux tab tail <tabId> [--follow-status] […]       NDJSON stream of renders / status',
      '  aimux tab wait <tabId> --status <idle|working|waiting-input>  Block on an activity state',
      '  aimux workspace show                               Dump the active workspace + worktrees',
      '  aimux workspace create <name> [--project P] [--switch [--wait]]',
      '  aimux workspace switch <ws> [--wait --timeout N]   Move the running UI to another workspace',
      '  aimux worktree create --name <n> [--branch B --base R]',
      '  aimux worktree remove <id|path> [--force]',
      '',
      'Shared flags (accepted by every CLI verb)',
      '  --workspace <id|name>             Target a specific workspace (default: active)',
      '  --profile <name>                  Runtime profile (also settable via AIMUX_PROFILE)',
      '  --json                            Reserved; JSON is always on',
      '',
      'Maintenance',
      '  aimux update                      Update aimux to the latest published version',
      '  aimux doctor                      Diagnose setup (paths, sockets, PTY, integrations)',
      '  aimux restart-daemon              Restart the IPC daemon (keeps live workspaces)',
      '  aimux restart-terminal-manager    Restart terminal-manager (kills live workspaces)',
      '  aimux --version                   Print the installed version',
      '',
      'Exit codes',
      '  0    success',
      '  2    usage error (bad flags, unknown command, missing argument)',
      '  3    runtime error (server replied with error, command failed)',
      '  4    daemon unreachable (socket missing and autostart failed)',
      '  124  timeout (tab wait, tab tail --timeout, workspace switch --wait)',
      '',
      'Env',
      '  AIMUX_PROFILE                     Runtime profile (state dir, socket paths)',
      '',
      'Recipes for agents',
      '  # spawn Claude, wait for idle, dump the last 40 non-blank lines',
      '  TAB=$(aimux tab create --assistant claude --title fixup | jq -r .tabId)',
      '  aimux tab send "$TAB" "explain this repo" --enter',
      '  aimux tab wait "$TAB" --status idle --timeout 60000',
      '  aimux tab snapshot "$TAB" --tail 40 --format text',
      '',
      '  # send a control chord (Ctrl-C then Esc) using vim-style notation',
      '  aimux tab send "$TAB" "<C-c><Esc>" --keys',
      '',
      '  # follow a tab as NDJSON, one render (or tabStatus) per line',
      '  aimux tab tail "$TAB" --rate-limit-ms 100 --follow-status',
      '',
    ].join('\n')
  )
  process.exit(0)
}

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

const resolvedConfig = await loadUserConfig()
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
  onBreakingUpdateRequired: () =>
    new Promise<void>((resolve) => {
      root.render(<BreakingUpdateScreen onConfirm={resolve} />)
    }),
})
logDebug('index.backendReady', { backend: backend.constructor.name, runtimeProfile })

root.render(<App backend={backend} resolvedConfig={resolvedConfig} />)
