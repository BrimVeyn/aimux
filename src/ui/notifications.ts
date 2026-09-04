import type { PluginNotificationEvent } from '@brimveyn/aimux-plugin'

import { logDebug } from '../debug/input-log'
import { playNotificationSound } from '../settings/sections/notifications'
import { appStore } from '../state/app-store'
import { toast } from '../state/toast-store'

/**
 * Who delivers a notification.
 *
 * aimux's own notifications are a sound: an agent asking a question, an agent
 * finishing a turn, neither in the tab you are looking at. A plugin that
 * forwards those to a phone — ntfy, Telegram, a push relay — must *replace*
 * that delivery rather than double it, or the user hears the chime and then
 * reads the same news on their wrist.
 *
 * So this is a slot, on the `provideCommitMessage` model: one sink at a time,
 * the second is refused and told why in its own log, and while a sink holds
 * the slot the native sound does not play. A plugin's own `notify` goes
 * through the same door, so a Telegram sink also carries what other plugins
 * have to say.
 */

export type NotificationSink = (event: PluginNotificationEvent) => void | Promise<void>

interface Slot {
  pluginId: string
  sink: NotificationSink
}

let slot: Slot | null = null

export interface SinkRegistration {
  accepted: boolean
  reason?: string
  dispose: () => void
}

export function registerNotificationSink(
  pluginId: string,
  sink: NotificationSink
): SinkRegistration {
  if (slot !== null && slot.pluginId !== pluginId) {
    const reason = `${slot.pluginId} already provides notifications`
    logDebug('notifications.sink.refused', { held: slot.pluginId, pluginId })
    return {
      accepted: false,
      dispose: () => {
        /* nothing was taken, so nothing comes back */
      },
      reason,
    }
  }
  const entry: Slot = { pluginId, sink }
  slot = entry
  return {
    accepted: true,
    dispose: () => {
      if (slot === entry) slot = null
    },
  }
}

/** The plugin holding the slot, or null when aimux delivers its own. */
export function notificationSinkOwner(): string | null {
  return slot?.pluginId ?? null
}

/** Test seam. Never called by the app. */
export function clearNotificationSink(): void {
  slot = null
}

function deliverNatively(event: PluginNotificationEvent): void {
  if (event.kind === 'custom') {
    toast.show({
      message: event.message,
      title: event.title,
      variant: event.level ?? 'info',
    })
    return
  }
  playNotificationSound()
}

/**
 * Delivers one notification: to the sink when a plugin holds the slot, to
 * the sound and the toast otherwise. A sink that throws loses that event and
 * nothing else — a notification must never take the status loop with it.
 */
export function notify(event: PluginNotificationEvent): void {
  if (slot === null) {
    deliverNatively(event)
    return
  }
  const { pluginId, sink } = slot
  void (async () => {
    try {
      await sink(event)
    } catch (error) {
      logDebug('notifications.sink.failed', { error: String(error), pluginId })
    }
  })()
}

/** The title aimux's own events carry: the tab's name, which is what the user knows it by. */
function tabTitle(tabId: string): string {
  return appStore.getState().tabs.find((tab) => tab.id === tabId)?.title ?? tabId
}

export function notifyWaitingInput(tabId: string, workspaceId: string | undefined): void {
  notify({
    kind: 'waiting-input',
    message: 'An agent is waiting for your answer.',
    tabId,
    title: tabTitle(tabId),
    ...(workspaceId === undefined ? {} : { workspaceId }),
  })
}

export function notifyTurnComplete(tabId: string, workspaceId: string | undefined): void {
  notify({
    kind: 'turn-complete',
    message: 'An agent finished its turn.',
    tabId,
    title: tabTitle(tabId),
    ...(workspaceId === undefined ? {} : { workspaceId }),
  })
}
