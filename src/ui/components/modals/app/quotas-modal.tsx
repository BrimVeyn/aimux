import { QuotaWindows } from '../../stats/quotas'
import { ModalShell } from '../shared/modal-shell'

/**
 * The quota windows, and nothing else.
 *
 * What the status-bar indicator is a summary of: clicking it asks "how much is
 * left", which is one block of the stats screen. Opening the whole screen for
 * that made the reader find the answer among four other sections and then find
 * their way back. The screen is still there, behind the Stats button.
 */

/**
 * Wider than the shell's usual sizes, and deliberately so: at 56 the reset times
 * end a column from the border and the block reads as cramped. This one is a
 * readout, not a list of choices — it can afford the air.
 */
const WIDTH = 76
/** The shell's border and its one column of padding, both sides. */
const CHROME = 4

export function QuotasModal() {
  // Read per render like the stats page does: the store pushes a new snapshot
  // and the relative times ("1m ago") are measured against now, not against
  // when the modal happened to open.
  const now = new Date()

  return (
    <ModalShell
      title="Quotas"
      subtitle="live"
      keybindsModeId="modal.quotas"
      width={WIDTH}
      listGap={1}
    >
      {/* No projection here. `empty ~Fri 13:02` is worth the width on a page
          being read; on a glance at what is left it is a second timestamp to
          parse next to the one that matters. */}
      <QuotaWindows now={now} projection={false} width={WIDTH - CHROME} />
    </ModalShell>
  )
}
