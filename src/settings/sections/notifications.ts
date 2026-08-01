import type { SettingOption, SettingSection } from '../types'

import {
  BUILTIN_SOUND_IDS,
  getCustomSoundsDir,
  listCustomSoundIds,
  playSoundFile,
  resolveSoundPath,
  SOUND_OFF,
} from '../../platform/play-sound'
import { toast } from '../../state/toast-store'
import { settingsStore } from '../settings-store'

/** Read by `src/app-runtime/workspace-activity.ts`, which does the playing. */
export const NOTIFICATION_SOUND = 'notifications.sound'

/**
 * `off` plus the shipped three plus whatever is in the drop-in directory. Built
 * once, at import: a settings row's options are part of the schema (hydration
 * validates the stored value against them), so they cannot depend on a scan that
 * happens per render. A newly dropped file therefore shows up on the next
 * launch, which the row's description says out loud.
 */
const SOUND_OPTIONS: SettingOption[] = [
  { label: 'off', value: SOUND_OFF },
  ...BUILTIN_SOUND_IDS.map((id) => ({ label: id, value: id })),
  ...listCustomSoundIds().map((id) => ({ label: id, value: id })),
]

/** The selected sound id, or `off`. */
function selectedSoundId(): string {
  const value = settingsStore.getState().values[NOTIFICATION_SOUND]
  return typeof value === 'string' ? value : SOUND_OFF
}

/**
 * Play the configured notification sound, if any. Silent — and cheap — when the
 * user has set the row to `off`, which is what makes it safe to call on every
 * status edge.
 */
export function playNotificationSound(options?: { ignoreThrottle?: boolean }): boolean {
  const path = resolveSoundPath(selectedSoundId())
  if (path == null) return false
  return playSoundFile(path, options)
}

export const NOTIFICATIONS_SECTION: SettingSection = {
  description: 'Plays when an assistant needs an answer, or finishes a turn.',
  id: 'notifications',
  label: 'Notifications',
  rows: [
    {
      description: `"off" disables it. Drop your own in ${getCustomSoundsDir()} — picked up at the next launch.`,
      fallback: 'plane',
      id: NOTIFICATION_SOUND,
      kind: 'select',
      label: 'Sound',
      options: SOUND_OPTIONS,
      storage: 'settings',
    },
    {
      // The one way to find out that this machine has no audio player before a
      // notification you actually cared about goes silent.
      description: 'Play the selected sound now.',
      id: 'notifications.test',
      kind: 'action',
      label: 'Test sound',
      run: () => {
        if (selectedSoundId() === SOUND_OFF) {
          toast.info('Notification sound is off')
          return
        }
        if (!playNotificationSound({ ignoreThrottle: true })) {
          toast.error('Could not play that sound — see `aimux doctor`')
        }
      },
      value: () => selectedSoundId(),
    },
  ],
}
