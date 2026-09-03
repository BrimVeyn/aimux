import type { AIUsageTool, AIUsageToolConfig } from '@brimveyn/aimux-config'

import { definePlugin, type Disposer, type UiPluginContext } from '@brimveyn/aimux-plugin'

import { type AIUsageServiceHandle, startAIUsageService } from '../../services/ai-usage/provider'
import { aiUsageStore } from '../../state/ai-usage-store'
import { AIUsageIndicator } from './indicator'

/**
 * The quota tile on the right of the status bar, and the polling behind it.
 *
 * This was a `useEffect` in `app.tsx` plus a hard-coded slot in
 * `status-bar.tsx`. The slot is what made it worth migrating: the status bar
 * had no way to accept a tile from anywhere else, and "the AI usage indicator
 * is a plugin" is only true once that is fixed for everyone.
 *
 * Registration is tied to the toggle rather than to `apply`. A segment that
 * rendered nothing would still cost a tile and two separators, so the honest
 * expression of "off" is not being registered at all.
 */

/** Rows aimux already owns. The plugin obeys them; it does not replace them. */
const ENABLED_ROW = 'statusBar.aiUsage.enabled'
const POLL_SECONDS_ROW = 'statusBar.aiUsage.pollSeconds'

export default definePlugin({
  apply(context) {
    const ctx = context as UiPluginContext
    const { settings, statusBar } = ctx.ui

    /**
     * The service's configuration: the two rows the settings screen owns, over
     * the keys that only `aimux.config.ts` has — seeded into `ctx.config` by
     * the built-in's declaration, so nothing here reads aimux's config.
     */
    const serviceConfig = (): AIUsageToolConfig => {
      const poll = settings.get(POLL_SECONDS_ROW)
      const tools = ctx.config.tools
      return {
        claudePlan: ctx.config.claudePlan as AIUsageToolConfig['claudePlan'],
        codexWeeklyLimit:
          typeof ctx.config.codexWeeklyLimit === 'number' ? ctx.config.codexWeeklyLimit : undefined,
        enabled: true,
        ...(typeof poll === 'number' ? { pollSeconds: poll } : {}),
        ...(Array.isArray(tools) ? { tools: tools as AIUsageTool[] } : {}),
      }
    }

    ctx.effect(() => {
      let running: { handle: AIUsageServiceHandle; unregister: Disposer } | null = null

      const stop = (): void => {
        if (!running) return
        running.handle.stop()
        void running.unregister()
        running = null
        aiUsageStore.getState().clear()
        aiUsageStore.getState().setEnabled(false)
      }

      const start = (): void => {
        if (running) return
        aiUsageStore.getState().setEnabled(true)
        const handle = startAIUsageService(serviceConfig(), (snapshot) => {
          aiUsageStore.getState().setSnapshot(snapshot)
        })
        const unregister = statusBar.register({
          id: 'quota',
          render: () => <AIUsageIndicator />,
        })
        running = { handle, unregister }
      }

      // Order matters, and cheaply: `watch` fires immediately, so the poll
      // watcher goes on first, where it finds nothing running and does
      // nothing. The toggle then starts the service with the interval already
      // in hand, and a later interval change restarts it.
      const offPoll = settings.watch(POLL_SECONDS_ROW, () => {
        if (!running) return
        stop()
        start()
      })
      const offEnabled = settings.watch(ENABLED_ROW, (value) => {
        if (value === true) start()
        else stop()
      })

      return () => {
        void offPoll()
        void offEnabled()
        stop()
      }
    })
  },
})
