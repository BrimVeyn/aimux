// Public API — what plugin authors import from '@brimveyn/aimux-plugin'.
//
// Everything here is `apiVersion: 1`. A plugin declares that number in its
// manifest and aimux refuses to load a plugin written against a generation it
// does not implement, rather than failing halfway through `apply`.

export type {
  PluginAssistantsApi,
  PluginCliApi,
  PluginCounterDay,
  PluginHooksApi,
  PluginMetricsApi,
  PluginProjectsApi,
  PluginProjectView,
  PluginSpawnTabInput,
  PluginTabsApi,
  PluginTabView,
  PluginWorkspacesApi,
  PluginWorkspaceView,
} from './daemon-api'
export { definePlugin } from './define-plugin'
export { EffectStack } from './effects'
export { type EventBusOptions, PluginEventBus } from './event-bus'
export {
  PLUGIN_API_VERSION,
  type PluginBarContribution,
  type PluginCommandSpec,
  type PluginConfigField,
  type PluginConfigFieldType,
  type PluginContributions,
  type PluginHost,
  type PluginKeymapContribution,
  type PluginManifest,
} from './manifest'
export { createTestUiSurface, type TestUiRegistrations, type TestUiSurface } from './test-ui'
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
  PluginCommitMessage,
  PluginCommitMessageRequest,
  PluginComponent,
  PluginGitApi,
  PluginGitFile,
  PluginGitStatus,
  PluginKit,
  PluginModal,
  PluginModalsApi,
  PluginNode,
  PluginPane,
  PluginPanesApi,
  PluginSettingsApi,
  PluginSettingValue,
  PluginStateApi,
  PluginStatsApi,
  PluginStatsPage,
  PluginStatusBarApi,
  PluginStatusBarSegment,
  PluginStoreApi,
  PluginTabInfo,
  PluginThemeMode,
  PluginThemesApi,
  PluginThemeSnapshot,
  PluginToastApi,
  PluginUiApi,
  PluginUiState,
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
