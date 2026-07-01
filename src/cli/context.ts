import type { SessionRecord } from '../state/types'
import type { DaemonClient } from './client/daemon-client'
import type { ParsedArgs } from './flags'

/**
 * Per-command context handed to `CliCommand.run`. Commands lazily resolve
 * the workspace + daemon via the helpers on this object so a command that
 * only reads flags (e.g. `workspace list`) doesn't have to open a socket.
 */
export interface CliContext {
  args: ParsedArgs
  /** Already-running daemon client, populated on first call to `daemon()`. */
  getDaemon: () => Promise<DaemonClient>
  /** Resolved workspace, populated on first call to `workspace()`. */
  getWorkspace: () => SessionRecord
}
