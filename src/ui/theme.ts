// Back-compat shim: the theme singleton has been replaced with a Zustand store.
// React components use `useTokens` for derived shades; non-React callers use
// `getCurrentTheme()` / `getCurrentTokens()`.

export {
  applyTheme,
  getCurrentTheme,
  getCurrentTokens,
  getTransparent,
  setTransparent,
  type SurfaceToken,
  type ThemeTokens,
  useBg,
  useTokens,
  useTransparent,
} from './theme-store'
