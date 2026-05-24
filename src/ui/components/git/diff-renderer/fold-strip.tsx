import { memo, useCallback } from 'react'

import type { FoldDispatch } from './pierre-diff'

import { useTheme } from '../../../theme'
import { FOLD_STEP, type FoldInfo } from './build-rows'

interface Props {
  fold: FoldInfo
  dispatch: FoldDispatch
}

const Button = memo(function Button({ label, onPress }: { label: string; onPress: () => void }) {
  const t = useTheme()
  const bg = t.diffContextBg
  return (
    <box paddingLeft={1} paddingRight={1} backgroundColor={bg} onMouseDown={onPress}>
      <text fg={t.primary}>{label}</text>
    </box>
  )
})

function Spacer() {
  return <text> </text>
}

export function FoldStrip({ dispatch, fold }: Props) {
  const t = useTheme()
  const headerBg = t.diffContextBg
  const { bottomExpanded, foldId, hidden, topExpanded, total } = fold
  const stepUp = Math.min(FOLD_STEP, hidden)
  const stepDown = Math.min(FOLD_STEP, hidden)
  const shrinkUp = Math.min(FOLD_STEP, topExpanded)
  const shrinkDown = Math.min(FOLD_STEP, bottomExpanded)

  const handleExpandTop = useCallback(
    () => dispatch.adjust(foldId, 'top', stepUp),
    [dispatch, foldId, stepUp]
  )
  const handleExpandBottom = useCallback(
    () => dispatch.adjust(foldId, 'bottom', stepDown),
    [dispatch, foldId, stepDown]
  )
  const handleExpandAll = useCallback(
    () => dispatch.set(foldId, total, 0),
    [dispatch, foldId, total]
  )
  const handleShrinkTop = useCallback(
    () => dispatch.adjust(foldId, 'top', -shrinkUp),
    [dispatch, foldId, shrinkUp]
  )
  const handleShrinkBottom = useCallback(
    () => dispatch.adjust(foldId, 'bottom', -shrinkDown),
    [dispatch, foldId, shrinkDown]
  )

  const controls: React.ReactNode[] = []
  if (hidden > 0) {
    controls.push(
      <Button key="up" label={`↑${stepUp}`} onPress={handleExpandTop} />,
      <Spacer key="sp1" />,
      <Button key="down" label={`↓${stepDown}`} onPress={handleExpandBottom} />,
      <Spacer key="sp2" />,
      <Button key="all" label="⇅ all" onPress={handleExpandAll} />
    )
  }
  if (shrinkUp > 0) {
    controls.push(
      <Spacer key="sp3" />,
      <Button key="shrinkUp" label={`−↑${shrinkUp}`} onPress={handleShrinkTop} />
    )
  }
  if (shrinkDown > 0) {
    controls.push(
      <Spacer key="sp4" />,
      <Button key="shrinkDown" label={`−↓${shrinkDown}`} onPress={handleShrinkBottom} />
    )
  }

  return (
    <box flexDirection="row" backgroundColor={headerBg} paddingLeft={1} paddingRight={1}>
      <text fg={t.textMuted}>{`⋯ ${hidden} hidden `}</text>
      {controls}
    </box>
  )
}
