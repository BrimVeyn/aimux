export const GIT_PANE_MIN_RATIO = 0.2
export const GIT_PANE_MAX_RATIO = 0.8
export const GIT_PANE_MIN_WIDTH = 20
export const GIT_PANE_MAX_WIDTH = 80

export function clampGitPaneRatio(value: number): number {
  return Math.max(GIT_PANE_MIN_RATIO, Math.min(GIT_PANE_MAX_RATIO, value))
}

export function getGitPaneWidthFromRatio(ratio: number): number {
  return Math.max(
    GIT_PANE_MIN_WIDTH,
    Math.min(GIT_PANE_MAX_WIDTH, Math.round(clampGitPaneRatio(ratio) * GIT_PANE_MAX_WIDTH))
  )
}
