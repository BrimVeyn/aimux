import { appendFileSync } from 'node:fs'
import { join } from 'node:path'

import { ensureRuntimeDir } from '../daemon/runtime-paths'

export const UI_CRASH_LOG_FILENAME = 'ui-crash.log'

export function getUiCrashLogPath(): string {
  return join(ensureRuntimeDir(), UI_CRASH_LOG_FILENAME)
}

/**
 * Keeps a record of what killed the UI.
 *
 * An uncaught exception ends the UI process, and the stack Bun prints for it
 * lands on the alternate screen, which the terminal throws away a moment
 * later. The debug log only runs when asked for, which is never the time it
 * crashes. So the error goes to a file in the profile's state directory,
 * always.
 *
 * A monitor, not a handler: it sees the exception without catching it, so the
 * process still exits the way it did before — this only adds the record.
 */
export function installCrashRecord(): () => void {
  // `unknown`: anything can be thrown, not only an Error.
  const onException = (error: unknown, origin: string): void => {
    try {
      const detail = error instanceof Error ? (error.stack ?? error.message) : String(error)
      appendFileSync(
        getUiCrashLogPath(),
        `${new Date().toISOString()} pid ${process.pid} ${origin}\n${detail}\n\n`
      )
    } catch {
      // Nowhere left to report a failure to write the report.
    }
  }

  process.on('uncaughtExceptionMonitor', onException)
  return () => {
    process.off('uncaughtExceptionMonitor', onException)
  }
}
