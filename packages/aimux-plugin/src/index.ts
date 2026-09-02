// Public API — what plugin authors import from '@brimveyn/aimux-plugin'.
//
// Everything here is `apiVersion: 1`. A plugin declares that number in its
// manifest and aimux refuses to load a plugin written against a generation it
// does not implement, rather than failing halfway through `apply`.

export type {
  PluginAssistantsApi,
  PluginCliApi,
  PluginHooksApi,
  PluginProjectsApi,
  PluginSpawnTabInput,
  PluginTabsApi,
  PluginTabView,
  PluginWorkspacesApi,
} from './daemon-api'
export { definePlugin } from './define-plugin'
export { EffectStack } from './effects'
export { type EventBusOptions, PluginEventBus } from './event-bus'
export {
  PLUGIN_API_VERSION,
  type PluginCommandSpec,
  type PluginConfigField,
  type PluginConfigFieldType,
  type PluginHost,
  type PluginManifest,
} from './manifest'
export {
  createTestContext,
  type TestContextHandle,
  type TestContextOptions,
  type TestLogEntry,
  type TestRpcCall,
} from './test-context'
export type {
  PluginActionsApi,
  PluginBarWidget,
  PluginComponent,
  PluginKit,
  PluginModal,
  PluginModalsApi,
  PluginNode,
  PluginSettingsApi,
  PluginSettingValue,
  PluginStatsApi,
  PluginStatsPage,
  PluginStoreApi,
  PluginThemeMode,
  PluginThemesApi,
  PluginThemeSnapshot,
  PluginToastApi,
  PluginUiApi,
  PluginView,
  PluginViewsApi,
  PluginWidgetsApi,
} from './ui'
export type {
  DaemonPluginContext,
  Disposer,
  PluginContext,
  PluginDefinition,
  PluginEventDispatch,
  PluginEventListener,
  PluginLogger,
  PluginPaths,
  PluginRpc,
  UiPluginContext,
} from './types'
