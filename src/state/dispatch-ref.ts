import type { SideEffect } from '../input/modes/types'
import type { AppAction } from './actions'

type DispatchFn = (action: AppAction) => void
type SideEffectFn = (effect: SideEffect) => void

let activeDispatch: DispatchFn | null = null
let activeSideEffect: SideEffectFn | null = null

export function setActiveDispatch(dispatch: DispatchFn | null): void {
  activeDispatch = dispatch
}

export function dispatchGlobal(action: AppAction): void {
  activeDispatch?.(action)
}

export function setActiveSideEffectRunner(runner: SideEffectFn | null): void {
  activeSideEffect = runner
}

export function runSideEffectGlobal(effect: SideEffect): void {
  activeSideEffect?.(effect)
}
