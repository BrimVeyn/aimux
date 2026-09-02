// The action union lives in `@brimveyn/aimux-config`: an action factory in a
// user's keymap builds these values, so the definition has to be importable
// without the aimux binary. Re-exported here so every dispatch site in `src/`
// keeps its import path.
//
// Split from the state shapes on the same principle as before: the shapes are
// read by the whole app, this union only by the reducer and what dispatches
// into it.

export type {
  AppAction,
  AutoCommitAction,
  DataAction,
  GitModeAction,
  GitPanelAction,
  LayoutAction,
  ModalAction,
  MultiRepoAction,
  ProjectAction,
  SettingsAction,
  StatsAction,
  TabAction,
  UIAction,
} from '@brimveyn/aimux-config'
