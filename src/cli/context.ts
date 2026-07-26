import type { SessionRecord } from '../state/types'
import type { DaemonClient } from './client/daemon-client'
import type { WorkspaceOrigin } from './client/workspace-resolver'
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
  /**
   * Every catalogued workspace. Commands that must answer "is my worker really
   * gone, or did the active workspace move?" need the whole catalog, not just
   * the resolved record. Optional so test fixtures can inject one.
   */
  getWorkspaces?: () => SessionRecord[]
  /**
   * Where `getWorkspace()` came from — `flag` (`--workspace`), `env`
   * (`AIMUX_WORKSPACE`), or `active` (most recently opened session). Only
   * `active` can drift under a command while the UI switches workspaces, so
   * commands that must not follow the UI branch on this. Optional so test
   * fixtures can build a minimal context.
   */
  getWorkspaceOrigin?: () => WorkspaceOrigin
}
