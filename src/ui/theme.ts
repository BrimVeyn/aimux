// Back-compat shim: the theme singleton has been replaced with a Zustand store.
// React components should import `useTheme` from `./theme-store`; non-React
// callers use `getCurrentTheme()`. `applyTheme` moved to the store module.

export {
  applyTheme,
  getCurrentTheme,
  getTransparent,
  setTransparent,
  useBg,
  useTheme,
  useTransparent,
} from './theme-store'
