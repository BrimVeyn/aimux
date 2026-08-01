import type { ProjectRecord } from '../state/types'
import type { DaemonClient } from './client/daemon-client'
import type { ProjectOrigin } from './client/project-resolver'
import type { ParsedArgs } from './flags'

/**
 * Per-command context handed to `CliCommand.run`. Commands lazily resolve
 * the project + daemon via the helpers on this object so a command that
 * only reads flags (e.g. `project list`) doesn't have to open a socket.
 */
export interface CliContext {
  args: ParsedArgs
  /** Already-running daemon client, populated on first call to `daemon()`. */
  getDaemon: () => Promise<DaemonClient>
  /** Resolved project, populated on first call to `project()`. */
  getProject: () => ProjectRecord
  /**
   * Every catalogued project. Commands that must answer "is my worker really
   * gone, or did the active project move?" need the whole catalog, not just
   * the resolved record. Optional so test fixtures can inject one.
   */
  getProjects?: () => ProjectRecord[]
  /**
   * Where `getProject()` came from — `flag` (`--project`), `env`
   * (`AIMUX_PROJECT`), or `active` (most recently opened project). Only
   * `active` can drift under a command while the UI switches projects, so
   * commands that must not follow the UI branch on this. Optional so test
   * fixtures can build a minimal context.
   */
  getProjectOrigin?: () => ProjectOrigin
}
