// The row and section shapes live in `@brimveyn/aimux-config`: a plugin
// registers a settings section, and it must be able to type one without
// depending on the aimux binary. Re-exported here so every import site in
// `src/settings` is unchanged.

export type {
  PluginSettingRow,
  SettingCtx,
  SettingOption,
  SettingRow,
  SettingSection,
  SettingValue,
  StoredSettingRow,
  StoredSettings,
} from '@brimveyn/aimux-config'
