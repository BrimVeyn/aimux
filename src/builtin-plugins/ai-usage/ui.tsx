import type { AIUsageTool, AIUsageToolConfig } from '@brimveyn/aimux-config'

import { definePlugin, type UiPluginContext } from '@brimveyn/aimux-plugin'

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
 * Being loaded is the whole switch. There used to be a second one — a
 * `statusBar.aiUsage.enabled` settings row the plugin watched — and a feature
 * with two switches is a feature you can turn on and watch do nothing. The
 * plugin is the indicator: `apply` registers the tile and starts the service,
 * unloading takes both away.
 */

/** The one row aimux still owns for this. The plugin obeys it; it does not replace it. */
const POLL_SECONDS_ROW = 'statusBar.aiUsage.pollSeconds'

export default definePlugin({
  apply(context) {
    const ctx = context as UiPluginContext
    const { settings, statusBar } = ctx.ui

    /**
     * The service's configuration: the one row the settings screen owns, over
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
        ...(typeof poll === 'number' ? { pollSeconds: poll } : {}),
        ...(Array.isArray(tools) ? { tools: tools as AIUsageTool[] } : {}),
      }
    }

    ctx.effect(() => {
      const unregister = statusBar.register({
        id: 'quota',
        render: () => <AIUsageIndicator />,
      })

      // `watch` fires immediately, so the service is started by its own first
      // call rather than alongside it — one place that builds a handle, and a
      // later interval change is the same path as the first start.
      let handle: AIUsageServiceHandle | null = null
      const offPoll = settings.watch(POLL_SECONDS_ROW, () => {
        handle?.stop()
        handle = startAIUsageService(serviceConfig(), (snapshot) => {
          aiUsageStore.getState().setSnapshot(snapshot)
        })
      })

      return () => {
        void offPoll()
        handle?.stop()
        void unregister()
        aiUsageStore.getState().clear()
      }
    })
  },
})
