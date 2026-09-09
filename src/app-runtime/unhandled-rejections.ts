import { logDebug } from '../debug/input-log'
import { toast } from '../state/toast-store'

/**
 * Where a promise nobody awaited goes to be reported.
 *
 * Node's default is to print the rejection to stderr, and stderr in the UI
 * process is the alternate screen: a stack trace painted across whatever aimux
 * had drawn, three panes deep, until something forces a redraw. The rejection
 * is worth knowing about; printing it over the interface is not how.
 *
 * Only rejections. An uncaught *exception* leaves the process in a state
 * nobody reasoned about, and the daemon's answer to that — shut down cleanly —
 * is still the right one; this handler is for the case where the program is
 * fine and one promise is not.
 *
 * The common source is a plugin: `runPluginEffect` already contains what an
 * effect throws, but a plugin that starts work with `void` rather than
 * awaiting it inside the effect hands the rejection to the process instead.
 */
export function installUnhandledRejectionHandler(): () => void {
  const onRejection = (reason: unknown): void => {
    const error = reason instanceof Error ? reason : new Error(String(reason))
    logDebug('ui.unhandledRejection', { error: error.message, stack: error.stack })
    toast.error(`unhandled: ${error.message}`)
  }

  process.on('unhandledRejection', onRejection)
  return () => {
    process.off('unhandledRejection', onRejection)
  }
}
