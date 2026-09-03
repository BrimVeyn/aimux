import {
  getStatusBarSeparator,
  type ResolvedTuiTheme,
  type StatusBarSeparator,
} from '@brimveyn/aimux-config'

import type { AppState } from '../../../state/types'

import { version as APP_VERSION } from '../../../../package.json'
import { useStatusBarHints } from '../../../settings/live'
import { useAppStore } from '../../../state/app-store'
import { useKeymap } from '../../keymap-context'
import { getStatusBarModel, type IdentitySegment } from '../../status-bar-model'
import { useStatusBarSegments } from '../../status-bar-segments'
import { useBaseTheme, useTheme } from '../../theme'

// Powerline-style separator glyph pairs.
// `right` is rendered between left-anchored tiles (A→B, B→filler).
// `left` is rendered between right-anchored tiles (filler→Y, X→Y).
// `none` uses empty strings so bare background transitions remain visible.
const SEPARATOR_GLYPHS: Record<StatusBarSeparator, { left: string; right: string }> = {
  arrow: { left: '\u{E0B2}', right: '\u{E0B0}' },
  flame: { left: '\u{E0C2}', right: '\u{E0C0}' },
  none: { left: '', right: '' },
  round: { left: '\u{E0B6}', right: '\u{E0B4}' },
  slant: { left: '\u{E0BA}', right: '\u{E0BC}' },
}

// Mode label is padded to a fixed width so the A tile never resizes
// when switching modes — keeps the rest of the bar visually stable.
const MODE_LABEL_WIDTH = 6
// A tile width = padded label (6) + paddingLeft (1) + paddingRight (1).
// Row 2 indents past A + separator glyph + B's paddingLeft so the
// hints line up with the start of B's content.
const ROW2_INDENT = MODE_LABEL_WIDTH + 2 + 1 + 1

function getModeLabel(focusMode: AppState['focusMode']): string {
  switch (focusMode) {
    case 'terminal-input':
      return 'INSERT'
    case 'modal':
      return 'MODAL'
    case 'command-edit':
      return 'EDIT'
    case 'git':
      return 'GIT'
    case 'settings':
      return 'SET'
    case 'navigation':
    default:
      return 'NORMAL'
  }
}

function getModeBadge(focusMode: AppState['focusMode']): string {
  const label = getModeLabel(focusMode)
  const totalPad = Math.max(0, MODE_LABEL_WIDTH - label.length)
  const left = Math.floor(totalPad / 2)
  const right = totalPad - left
  return ' '.repeat(left) + label + ' '.repeat(right)
}

function getModeColor(focusMode: AppState['focusMode'], t: ResolvedTuiTheme): string {
  switch (focusMode) {
    case 'terminal-input':
      return t.primary
    case 'modal':
    case 'command-edit':
      return t.warning
    case 'git':
      return t.success
    case 'settings':
      return t.secondary
    case 'navigation':
    default:
      return t.text
  }
}

function composeAmbient(right: string, help: string): string {
  if (right === '' && help === '') return ''
  if (right === '') return help
  if (help === '') return right
  return `${right}  ·  ${help}`
}

function Segments({ segments, t }: { segments: IdentitySegment[]; t: ResolvedTuiTheme }) {
  return (
    <>
      {segments.map((seg) => (
        <text
          key={seg.id}
          fg={seg.tone === 'primary' ? t.text : t.textMuted}
          wrapMode="none"
          selectable={false}
        >
          {seg.text}
        </text>
      ))}
    </>
  )
}

function Separator({ bg, fg, glyph }: { bg: string; fg: string; glyph: string }) {
  if (glyph === '') return null
  return (
    <box backgroundColor={bg}>
      <text fg={fg} selectable={false}>
        {glyph}
      </text>
    </box>
  )
}

export function StatusBar() {
  const t = useTheme()
  // Badge foregrounds (mode label, version) sit on colored tiles and would
  // render invisible with a transparent chrome color — always use the base
  // (opaque) background token for contrast against those tiles.
  const base = useBaseTheme()
  const state = useAppStore((s) => s)
  const config = useKeymap()
  const model = getStatusBarModel(state, config)
  const modeColor = getModeColor(state.focusMode, t)
  const ambient = composeAmbient(model.right, model.help)
  const segments = useStatusBarSegments()
  const showHints = useStatusBarHints()

  const glyphs = SEPARATOR_GLYPHS[getStatusBarSeparator()]

  // The bar's own band is backgroundElement, not backgroundPanel: the chrome
  // directly above it — the tab bar and both widget bars — is panel, and with no
  // rules left anywhere the status bar merged into it. Its two mid tiles drop to
  // panel to keep a step between tile and filler. Which of the three tones is
  // lighter is a theme's business (catppuccin recesses, aimux lifts); all that
  // matters is that they are three different tokens.
  const tileB = t.backgroundPanel
  const tileFiller = t.backgroundElement
  const tileX = t.backgroundPanel
  const tileY = modeColor

  const hasB = model.projectSegments.length > 0
  const hasX = segments.length > 0

  return (
    <box
      height={showHints ? 2 : 1}
      flexShrink={0}
      overflow="hidden"
      flexDirection="column"
      backgroundColor={tileFiller}
    >
      {/* Row 1 — lualine tiles */}
      <box height={1} flexShrink={0} flexDirection="row" overflow="hidden">
        {/* A: mode */}
        <box backgroundColor={modeColor} paddingLeft={1} paddingRight={1}>
          <text fg={base.background} selectable={false}>
            {getModeBadge(state.focusMode)}
          </text>
        </box>

        {/* A → B (or A → filler if B empty) */}
        <Separator glyph={glyphs.right} bg={hasB ? tileB : tileFiller} fg={modeColor} />

        {hasB ? (
          <>
            <box
              backgroundColor={tileB}
              paddingLeft={1}
              paddingRight={1}
              flexDirection="row"
              flexShrink={1}
              overflow="hidden"
            >
              <Segments segments={model.projectSegments} t={t} />
            </box>
            <Separator glyph={glyphs.right} bg={tileFiller} fg={tileB} />
          </>
        ) : null}

        {/* Filler */}
        <box flexGrow={1} flexShrink={1} backgroundColor={tileFiller} />

        {hasX ? (
          <>
            <Separator glyph={glyphs.left} bg={tileFiller} fg={tileX} />
            <box
              backgroundColor={tileX}
              paddingLeft={1}
              paddingRight={1}
              flexDirection="row"
              flexShrink={0}
            >
              {segments.map((segment) => (
                <box key={segment.id} flexDirection="row">
                  {segment.render()}
                </box>
              ))}
            </box>
            <Separator glyph={glyphs.left} bg={tileX} fg={tileY} />
          </>
        ) : (
          <Separator glyph={glyphs.left} bg={tileFiller} fg={tileY} />
        )}

        {/* Y: version */}
        <box backgroundColor={tileY} paddingLeft={1} paddingRight={1} flexShrink={0}>
          <text fg={base.background} selectable={false}>
            v{APP_VERSION}
          </text>
        </box>
      </box>

      {/* Row 2 — ambient hints */}
      {showHints ? (
        <box
          height={1}
          flexShrink={0}
          flexDirection="row"
          paddingLeft={ROW2_INDENT}
          paddingRight={1}
          overflow="hidden"
        >
          {ambient !== '' ? (
            <text fg={t.textMuted} wrapMode="none" selectable={false}>
              {ambient}
            </text>
          ) : null}
        </box>
      ) : null}
    </box>
  )
}
