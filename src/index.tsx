#!/usr/bin/env bun
import { createCliRenderer } from '@opentui/core'
import { createRoot } from '@opentui/react'

import { App } from './app'
import { runDaemon } from './daemon/daemon'
import { logDebug } from './debug/input-log'
import { runDoctor } from './doctor'
import { runRestartDaemon } from './restart-daemon'
import { createSessionBackend } from './session-backend/bootstrap'
import { runUpdate } from './update'

const command = process.argv[2]

if (command === '--version' || command === '-v') {
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

if (command === 'update') {
  process.exit(await runUpdate())
}

if (command === 'daemon') {
  logDebug('index.daemonMode')
  await runDaemon()
}

if (command === '--help' || command === '-h') {
  process.stdout.write(
    'aimux -- terminal multiplexer for AI CLIs\n\nUsage:\n  aimux                  Start aimux\n  aimux update           Update to latest version\n  aimux doctor           Diagnose setup issues\n  aimux restart-daemon   Restart background daemon\n\n'
  )
  process.exit(0)
}

const renderer = await createCliRenderer({
  exitOnCtrlC: false,
  useAlternateScreen: true,
  useConsole: false,
  autoFocus: true,
  useMouse: true,
})

const backend = await createSessionBackend()
logDebug('index.backendReady', { backend: backend.constructor.name })

createRoot(renderer).render(<App backend={backend} />)
