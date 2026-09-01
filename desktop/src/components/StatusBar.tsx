import { AIUsageIndicator } from "@/components/AIUsageIndicator";
import { theme } from "@/lib/theme";
import type {
  AppStateProjection,
  FocusMode,
  IdentitySegment,
  StatusBarSeparatorKind,
} from "@/lib/types";

/**
 * Transcription of `src/ui/components/layout/status-bar.tsx`: a lualine-style
 * row of tiles — mode, identity, filler, AI usage, version — joined by
 * powerline glyphs, with an optional second row of ambient hints.
 *
 * Everything it draws is one terminal row tall, on the same cell grid as the
 * panes above it.
 */

// Powerline-style separator glyph pairs.
// `right` is rendered between left-anchored tiles (A→B, B→filler).
// `left` is rendered between right-anchored tiles (filler→Y, X→Y).
// `none` uses empty strings so bare background transitions remain visible.
const SEPARATOR_GLYPHS: Record<
  StatusBarSeparatorKind,
  { left: string; right: string }
> = {
  arrow: { left: "\u{E0B2}", right: "\u{E0B0}" },
  flame: { left: "\u{E0C2}", right: "\u{E0C0}" },
  none: { left: "", right: "" },
  round: { left: "\u{E0B6}", right: "\u{E0B4}" },
  slant: { left: "\u{E0BA}", right: "\u{E0BC}" },
};

// Mode label is padded to a fixed width so the A tile never resizes
// when switching modes — keeps the rest of the bar visually stable.
const MODE_LABEL_WIDTH = 6;
// A tile width = padded label (6) + paddingLeft (1) + paddingRight (1).
// Row 2 indents past A + separator glyph + B's paddingLeft so the
// hints line up with the start of B's content.
const ROW2_INDENT = MODE_LABEL_WIDTH + 2 + 1 + 1;

function getModeLabel(focusMode: FocusMode): string {
  switch (focusMode) {
    case "terminal-input":
      return "INSERT";
    case "modal":
      return "MODAL";
    case "command-edit":
      return "EDIT";
    case "git":
      return "GIT";
    case "settings":
      return "SET";
    default:
      return "NORMAL";
  }
}

function getModeBadge(focusMode: FocusMode): string {
  const label = getModeLabel(focusMode);
  const totalPad = Math.max(0, MODE_LABEL_WIDTH - label.length);
  const left = Math.floor(totalPad / 2);
  return " ".repeat(left) + label + " ".repeat(totalPad - left);
}

function getModeColor(focusMode: FocusMode): string {
  switch (focusMode) {
    case "terminal-input":
      return theme.primary;
    case "modal":
    case "command-edit":
      return theme.warning;
    case "git":
      return theme.success;
    case "settings":
      return theme.secondary;
    default:
      return theme.text;
  }
}

function composeAmbient(right: string, help: string): string {
  if (right === "" && help === "") return "";
  if (right === "") return help;
  if (help === "") return right;
  return `${right}  ·  ${help}`;
}

function Segments({ segments }: { segments: IdentitySegment[] }) {
  return (
    <>
      {segments.map((seg) => (
        <span
          key={seg.id}
          style={{
            color: seg.tone === "primary" ? theme.text : theme.textMuted,
          }}
        >
          {seg.text}
        </span>
      ))}
    </>
  );
}

function Separator({
  bg,
  fg,
  glyph,
}: {
  bg: string;
  fg: string;
  glyph: string;
}) {
  if (glyph === "") return null;
  return (
    <span aria-hidden style={{ backgroundColor: bg, color: fg }}>
      {glyph}
    </span>
  );
}

export function StatusBar({
  connecting,
  onOpenUsage,
  projection,
}: {
  projection: AppStateProjection;
  connecting: boolean;
  onOpenUsage: () => void;
}) {
  const { aiUsage, focusMode, statusBar } = projection;
  const modeColor = getModeColor(focusMode);
  const ambient = composeAmbient(statusBar.right, statusBar.help);
  const glyphs = SEPARATOR_GLYPHS[statusBar.separator];

  const tileB = theme.backgroundElement;
  const tileFiller = theme.backgroundPanel;
  const tileX = theme.backgroundElement;
  const tileY = modeColor;

  const hasB = statusBar.projectSegments.length > 0;
  const hasX = aiUsage.enabled;

  return (
    <div
      className="tui flex shrink-0 flex-col overflow-hidden"
      style={{ backgroundColor: tileFiller }}
    >
      {/* Row 1 — lualine tiles */}
      <div className="tui-row overflow-hidden">
        {/* A: mode. The badge is padded to a fixed width, so the tiles after it
            never shift when the mode changes. */}
        <span
          className="px-[1ch]"
          style={{ backgroundColor: modeColor, color: theme.background }}
        >
          {getModeBadge(focusMode)}
        </span>

        <Separator
          glyph={glyphs.right}
          bg={hasB ? tileB : tileFiller}
          fg={modeColor}
        />

        {hasB ? (
          <>
            <span
              className="flex min-w-0 shrink truncate px-[1ch]"
              style={{ backgroundColor: tileB }}
            >
              <Segments segments={statusBar.projectSegments} />
            </span>
            <Separator glyph={glyphs.right} bg={tileFiller} fg={tileB} />
          </>
        ) : null}

        <span className="flex-1" style={{ backgroundColor: tileFiller }}>
          {/* The one thing the TUI has no equivalent for: a socket that is not
              open yet. It lives in the filler because it is about the link, not
              about any tile's content. */}
          {connecting ? (
            <span className="pl-[1ch]" style={{ color: theme.warning }}>
              connecting…
            </span>
          ) : null}
        </span>

        {hasX ? (
          <>
            <Separator glyph={glyphs.left} bg={tileFiller} fg={tileX} />
            <span
              className="flex shrink-0 px-[1ch]"
              style={{ backgroundColor: tileX }}
            >
              <AIUsageIndicator aiUsage={aiUsage} onOpen={onOpenUsage} />
            </span>
            <Separator glyph={glyphs.left} bg={tileX} fg={tileY} />
          </>
        ) : (
          <Separator glyph={glyphs.left} bg={tileFiller} fg={tileY} />
        )}

        {/* Y: version */}
        <span
          className="shrink-0 px-[1ch]"
          style={{ backgroundColor: tileY, color: theme.background }}
        >
          v{statusBar.version}
        </span>
      </div>

      {/* Row 2 — ambient hints, indented to line up with B's content */}
      {statusBar.hints ? (
        <div
          className="tui-row overflow-hidden pr-[1ch]"
          style={{ color: theme.textMuted, paddingLeft: `${ROW2_INDENT}ch` }}
        >
          {ambient}
        </div>
      ) : null}
    </div>
  );
}
