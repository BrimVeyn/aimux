import { definePlugin, type PluginNode, type UiPluginContext } from '@brimveyn/aimux-plugin'

import { HISTORY, percent, type Sample, sparkline } from './sample'

/**
 * The drawing half. It owns no timer and spawns nothing: samples arrive as
 * broadcasts from the daemon half, which is the shape any "watch something and
 * show it" plugin wants.
 */

interface Slice {
  samples: Sample[]
}

const EMPTY: Slice = { samples: [] }

/** Module-level so they keep their identity between renders. */
const pickCpu = (sample: Sample): number | null => sample.cpu
const pickGpu = (sample: Sample): number | null => sample.gpu

export default definePlugin({
  apply(context) {
    const ctx = context as UiPluginContext<Slice>

    ctx.store.reducer((slice = EMPTY, action) => {
      if (action.actionId !== 'sample') return slice
      // Bounded on the way in. A widget that keeps every sample it has ever
      // seen is a memory leak with a nice graph on top.
      return { samples: [...slice.samples, action.payload as Sample].slice(-HISTORY) }
    })

    // The other end of `ctx.rpc.broadcast` in the daemon half. A broadcast has
    // no caller waiting, so this returns nothing.
    ctx.rpc.handle('sample', (payload) => {
      ctx.store.dispatch('sample', payload)
    })

    /**
     * Takes the samples and a picker rather than a mapped array: a prop built
     * in the parent's render is a new array every frame, and the child then
     * re-renders whether or not anything moved.
     */
    function Series({
      label,
      pick,
      samples,
      width,
    }: {
      label: string
      pick: (sample: Sample) => number | null
      samples: readonly Sample[]
      width: number
    }): PluginNode {
      const theme = ctx.ui.kit.useTheme()
      const values = samples.map(pick)
      const latest = values.at(-1) ?? null
      // Three characters for the label, five for the reading, the rest is graph.
      const graphWidth = Math.max(0, width - label.length - 7)
      return (
        <box flexDirection="row">
          <text fg={theme.textMuted}>{`${label} `}</text>
          <text fg={theme.accent}>{sparkline(values, graphWidth)}</text>
          <text
            fg={latest === null ? theme.textMuted : theme.text}
          >{` ${percent(latest).padStart(4)}`}</text>
        </box>
      )
    }

    function LoadPanel({ contentWidth }: { contentWidth: number }): PluginNode {
      const { Panel } = ctx.ui.kit
      const theme = ctx.ui.kit.useTheme()
      const samples = (ctx.store.use() ?? EMPTY).samples
      const width = Math.max(8, contentWidth - 4)

      if (samples.length === 0) {
        return (
          <Panel title="Load">
            <text fg={theme.textMuted}>waiting for the first sample…</text>
          </Panel>
        )
      }

      return (
        <Panel title="Load">
          <Series label="cpu" pick={pickCpu} samples={samples} width={width} />
          <Series label="gpu" pick={pickGpu} samples={samples} width={width} />
        </Panel>
      )
    }

    ctx.ui.widgets.register({
      id: 'load',
      label: 'Load',
      render: (contentWidth) => <LoadPanel contentWidth={contentWidth} />,
    })
  },
})
