import { useTheme } from '../../theme'
import { FOLD_STEP, type FoldInfo } from './build-rows'
import { type FoldDispatch } from './pierre-diff'

interface Props {
  fold: FoldInfo
  dispatch: FoldDispatch
}

function Button({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme()
  return (
    <box
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={theme.colors['sideBar.background']}
      onMouseDown={onPress}
    >
      <text fg={theme.colors['textLink.foreground']}>{label}</text>
    </box>
  )
}

function Spacer() {
  return <text> </text>
}

export function FoldStrip({ dispatch, fold }: Props) {
  const theme = useTheme()
  const { bottomExpanded, foldId, hidden, topExpanded, total } = fold
  const stepUp = Math.min(FOLD_STEP, hidden)
  const stepDown = Math.min(FOLD_STEP, hidden)
  const shrinkUp = Math.min(FOLD_STEP, topExpanded)
  const shrinkDown = Math.min(FOLD_STEP, bottomExpanded)

  const controls: React.ReactNode[] = []
  if (hidden > 0) {
    controls.push(
      <Button
        key="up"
        label={`↑${stepUp}`}
        onPress={() => dispatch.adjust(foldId, 'top', stepUp)}
      />,
      <Spacer key="sp1" />,
      <Button
        key="down"
        label={`↓${stepDown}`}
        onPress={() => dispatch.adjust(foldId, 'bottom', stepDown)}
      />,
      <Spacer key="sp2" />,
      <Button key="all" label="⇅ all" onPress={() => dispatch.set(foldId, total, 0)} />
    )
  }
  if (shrinkUp > 0) {
    controls.push(
      <Spacer key="sp3" />,
      <Button
        key="shrinkUp"
        label={`−↑${shrinkUp}`}
        onPress={() => dispatch.adjust(foldId, 'top', -shrinkUp)}
      />
    )
  }
  if (shrinkDown > 0) {
    controls.push(
      <Spacer key="sp4" />,
      <Button
        key="shrinkDown"
        label={`−↓${shrinkDown}`}
        onPress={() => dispatch.adjust(foldId, 'bottom', -shrinkDown)}
      />
    )
  }

  return (
    <box
      flexDirection="row"
      backgroundColor={theme.colors['sideBarSectionHeader.background']}
      paddingLeft={1}
      paddingRight={1}
    >
      <text fg={theme.colors['descriptionForeground']}>{`⋯ ${hidden} hidden `}</text>
      {controls}
    </box>
  )
}
