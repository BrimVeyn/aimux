import type { TerminalSnapshot } from '../../../state/types'
import type { CliCommand } from '../../registry'

import { IPC_CAPABILITY_THIN_ATTACH } from '../../../ipc/protocol'
import { SHARED_FLAGS } from '../../flags'
import { EXIT_OK, writeJson } from '../../output'
import { snapshotTailLines, snapshotToLines } from '../../snapshot-render'

const RENDER_WAIT_MS = 500

export const tabSnapshot: CliCommand = {
  args: [{ name: 'tabId', required: true }],
  flags: [
    ...SHARED_FLAGS,
    { description: 'return only the last N non-blank lines', kind: 'number', name: 'tail' },
  ],
  group: 'tab',
  run: async (ctx) => {
    const tabId = ctx.args.positionals[0]
    if (typeof tabId !== 'string' || tabId.length === 0) {
      throw new Error('tabId is required')
    }
    const tail = typeof ctx.args.flags.tail === 'number' ? ctx.args.flags.tail : 0

    const workspace = ctx.getWorkspace()
    const daemon = await ctx.getDaemon()
    if (!daemon.hasCapability(IPC_CAPABILITY_THIN_ATTACH)) {
      throw new Error(
        'daemon predates thinAttach capability — restart aimux to pick up the new daemon'
      )
    }

    // Subscribe BEFORE attaching so a render fired between attach completion
    // and our subscription doesn't slip through.
    const renderState: { cancel: (() => void) | null } = { cancel: null }
    const renderPromise = new Promise<TerminalSnapshot | null>((resolve) => {
      const off = daemon.on('tabRender', (payload) => {
        if (payload.tabId !== tabId) return
        off()
        clearTimeout(timer)
        renderState.cancel = null
        resolve(payload.viewport)
      })
      const timer = setTimeout(() => {
        off()
        renderState.cancel = null
        resolve(null)
      }, RENDER_WAIT_MS)
      renderState.cancel = () => {
        clearTimeout(timer)
        off()
        resolve(null)
      }
    })

    const attach = await daemon.attach({
      cols: 0,
      rows: 0,
      sessionId: workspace.id,
      thin: true,
    })
    const tab = attach.tabs.find((t) => t.id === tabId)
    if (!tab) {
      renderState.cancel?.()
      throw new Error(`tab not found: ${tabId}`)
    }

    let snapshot = tab.viewport
    if (!snapshot || snapshot.lines.length === 0) {
      const awaited = await renderPromise
      if (awaited) snapshot = awaited
    } else {
      renderState.cancel?.()
    }

    if (!snapshot) {
      throw new Error('no snapshot available within timeout')
    }

    const lines = tail > 0 ? snapshotTailLines(snapshot, tail) : snapshotToLines(snapshot)
    let widest = 0
    for (const line of lines) {
      if (line.length > widest) widest = line.length
    }
    writeJson({
      cols: widest,
      cursor: {
        col: snapshot.cursorCol ?? null,
        row: snapshot.cursorRow ?? null,
        visible: snapshot.cursorVisible,
      },
      lines,
      rows: lines.length,
      tabId,
    })
    return EXIT_OK
  },
  summary: 'Snapshot the visible viewport of a tab as plain text',
  verb: 'snapshot',
}
