import type { SettingSection } from '../types'

import { version as APP_VERSION } from '../../../package.json'
import { getConfigPath } from '../../config'
import { getProfileConfigDir, getProfileName } from '../../profile-paths'
import { settingsStore } from '../settings-store'

/**
 * Read-only. Everything here answers a question you would otherwise answer by
 * digging through `~/.config`: which build is running, which profile, where its
 * files are, and how many settings your own config file is holding onto.
 */
export const ABOUT_SECTION: SettingSection = {
  glyph: '\u{00A7}',
  id: 'about',
  label: 'About',
  rows: [
    { id: 'about.version', kind: 'info', label: 'Version', value: () => APP_VERSION },
    {
      description: 'Set with --profile, or AIMUX_PROFILE in the environment.',
      id: 'about.profile',
      kind: 'info',
      label: 'Profile',
      value: () => getProfileName(),
    },
    {
      id: 'about.configDir',
      kind: 'info',
      label: 'Config directory',
      value: () => getProfileConfigDir(),
    },
    {
      description: 'Settings written here land in this file.',
      id: 'about.configFile',
      kind: 'info',
      label: 'App config',
      value: () => getConfigPath(),
    },
    {
      description: 'Those come back from your config file every launch.',
      id: 'about.fromConfigFile',
      kind: 'info',
      label: 'Set in aimux.config.ts',
      value: () => {
        const count = settingsStore.getState().fromConfigFile.size
        return count === 0 ? 'nothing' : `${String(count)} setting(s)`
      },
    },
  ],
}
