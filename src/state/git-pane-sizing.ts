export const GIT_PANE_MIN_RATIO = 0.2
export const GIT_PANE_MAX_RATIO = 0.8

export function clampGitPaneRatio(value: number): number {
  return Math.max(GIT_PANE_MIN_RATIO, Math.min(GIT_PANE_MAX_RATIO, value))
}
