import { createTestRenderer } from '@opentui/core/testing'
import { createRoot } from '@opentui/react'

import type { PluginNode } from './ui'

/**
 * Does it draw?
 *
 * `createTestContext` answers what a plugin *registers* — the widget exists,
 * the action is bound, an unload leaves nothing behind. It says nothing about
 * what any of it looks like, and a widget whose renderer throws on an empty
 * data set registers exactly as cleanly as one that works.
 *
 * aimux has a test renderer; a plugin author outside this repo did not. This is
 * that renderer, with the two lines of setup already done, in a separate entry
 * point so the extra dependencies stay out of a plugin's runtime:
 *
 * ```ts
 * import { renderPluginNode } from '@brimveyn/aimux-plugin/testing'
 *
 * const { frame } = await renderPluginNode(<MyWidget cols={30} rows={8} />)
 * expect(frame).toContain('CPU')
 * ```
 *
 * `@opentui/core` and `@opentui/react` are peers rather than dependencies: the
 * host already ships them, and a second copy in a plugin's tree is the module
 * duplication the plugin loader spends real effort avoiding at runtime.
 */

export interface RenderPluginOptions {
  /** Terminal size to render into. Defaults to a bar-sized 40×12. */
  cols?: number
  rows?: number
  /**
   * How long to keep rendering while `until` is false. A widget that fetches on
   * mount needs a few frames before it has anything to draw.
   */
  timeoutMs?: number
  /** Stop as soon as this is true of the current frame. Default: first frame. */
  until?: (frame: string) => boolean
}

export interface RenderedPlugin {
  /** The drawn frame, as text. */
  frame: string
  /** Renders again and returns the new frame — for asserting on a change. */
  next: () => Promise<string>
  /** Tears the renderer down. Call it, or the process keeps a root mounted. */
  dispose: () => void
}

const DEFAULT_COLS = 40
const DEFAULT_ROWS = 12
const DEFAULT_TIMEOUT_MS = 2_000
/** One macrotask, which is what React needs to commit the tree. */
const COMMIT_TICK_MS = 10

export async function renderPluginNode(
  node: PluginNode,
  options: RenderPluginOptions = {}
): Promise<RenderedPlugin> {
  const cols = options.cols ?? DEFAULT_COLS
  const rows = options.rows ?? DEFAULT_ROWS
  const { captureCharFrame, renderer, renderOnce } = await createTestRenderer({
    height: rows,
    width: cols,
  })
  const root = createRoot(renderer)
  root.render(node)

  const draw = async (): Promise<string> => {
    await renderOnce()
    return captureCharFrame()
  }

  // React commits on a macrotask, not on the render tick: capturing straight
  // after `root.render` gives a blank frame every time, which would make the
  // simplest possible assertion fail for a reason that has nothing to do with
  // the widget under test.
  await draw()
  await new Promise<void>((resolve) => setTimeout(resolve, COMMIT_TICK_MS))
  let frame = await draw()
  const until = options.until
  if (until !== undefined) {
    const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    while (!until(frame) && Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 10))
      frame = await draw()
    }
  }

  return {
    dispose: () => {
      root.unmount()
    },
    frame,
    next: draw,
  }
}
