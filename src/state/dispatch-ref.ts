import type { AppAction } from './types'

type DispatchFn = (action: AppAction) => void

let activeDispatch: DispatchFn | null = null

export function setActiveDispatch(dispatch: DispatchFn | null): void {
  activeDispatch = dispatch
}

export function dispatchGlobal(action: AppAction): void {
  activeDispatch?.(action)
}
