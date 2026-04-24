// Back-compat shim: the theme singleton has been replaced with a Zustand store.
// React components use `useTheme` for resolved tokens; non-React callers use
// `getCurrentTheme()` / `getCurrentResolved()`.

export type { ResolvedToken, ResolvedTokens } from './themes'
export {
  applyTheme,
  getCurrentPalette,
  getCurrentResolved,
  getCurrentTheme,
  getTransparent,
  setTransparent,
  usePalette,
  useTheme,
  useTransparent,
} from './theme-store'
