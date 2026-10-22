// Back-compat shim: the theme singleton lives in `theme-store.ts`. React
// components use `useTheme` for the resolved TUI token map; non-React callers
// use `getCurrentTheme()`.

export type { ResolvedTuiTheme } from './themes'
export {
  applyTheme,
  getBaseTheme,
  getCurrentMode,
  getCurrentTheme,
  getCurrentThemeId,
  getTransparent,
  setMode,
  setTransparent,
  useBaseTheme,
  useMode,
  useTheme,
  useTransparent,
} from './theme-store'
