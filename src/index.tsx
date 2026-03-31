import { createCliRenderer } from '@opentui/core'
import { createRoot } from '@opentui/react'

import { App } from './app'
import { runDaemon } from './daemon/daemon'
import { logDebug } from './debug/input-log'
import { runDoctor } from './doctor'
import { runRestartDaemon } from './restart-daemon'
import { createSessionBackend } from './session-backend/bootstrap'

const command = process.argv[2]

if (command === 'doctor' || command === '--doctor') {
  process.exit(runDoctor())
}

if (command === 'restart-daemon') {
  process.exit(await runRestartDaemon())
}

if (command === 'daemon') {
  logDebug('index.daemonMode')
  await runDaemon()
}

if (command === '--help' || command === '-h') {
  process.stdout.write(
    'aimux\n\nUsage:\n  bun run src/index.tsx\n  bun run src/index.tsx doctor\n  bun run src/index.tsx restart-daemon\n\n'
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
