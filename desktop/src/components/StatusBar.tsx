import { AIUsageIndicator } from "@/components/AIUsageIndicator";
import { theme } from "@/lib/theme";
import type {
  AppStateProjection,
  FocusMode,
  IdentitySegment,
} from "@/lib/types";

// Single-line, ambient status bar. No card background, no pill chips, no
// inline hint dump — keybind hints and version live behind a hover popover
// triggered by a discreet `?` button on the right. The focus mode is
// communicated by typography alone (the word itself is colored), pairing
// with the FocusModeRail above for a peripheral signal.
//
// The host pre-renders right/help/version strings (it owns the keymap config)
// and sends the identity breadcrumb as toned segments.

// Mirror of FocusModeRail's color mapping so the label and the rail
// communicate the focus mode with the same color, not two different ones.
function modeColor(focusMode: FocusMode): string {
  switch (focusMode) {
    case "terminal-input":
      return theme.accent;
    case "modal":
    case "command-edit":
      return theme.warning;
    case "git":
      return theme.success;
    default:
      return theme.primary;
  }
}

function modeLabel(focusMode: FocusMode): string {
  switch (focusMode) {
    case "terminal-input":
      return "input";
    case "modal":
      return "modal";
    case "command-edit":
      return "edit";
    case "git":
      return "git";
    default:
      return "nav";
  }
}

function ConnectionDot({ connecting }: { connecting: boolean }) {
  const color = connecting ? theme.warning : theme.success;
  return (
    <span
      aria-hidden
      className="inline-block h-[5px] w-[5px] rounded-full transition-[background-color] duration-300 ease-out"
      style={{
        backgroundColor: color,
        animation: connecting
          ? "aimux-status-pulse 1.6s cubic-bezier(0.4, 0, 0.6, 1) infinite"
          : undefined,
      }}
      title={connecting ? "Connecting…" : "Connected"}
    />
  );
}

function ModeLabel({ focusMode }: { focusMode: FocusMode }) {
  const color = modeColor(focusMode);
  const label = modeLabel(focusMode);
  return (
    <span
      className="chrome-label transition-[color] duration-200 ease-out"
      style={{ color, fontWeight: 600, letterSpacing: "0.005em" }}
    >
      {label}
    </span>
  );
}

/**
 * The identity breadcrumb. The host sends toned segments, so this no longer
 * splits a string on a nerd-font glyph to guess where one ends: `primary` is
 * the project, `muted` is everything trailing it, separators included.
 */
function ProjectBreadcrumb({ segments }: { segments: IdentitySegment[] }) {
  if (segments.length === 0) return null;
  return (
    <span
      className="chrome-meta flex min-w-0 items-baseline truncate"
      title={segments.map((seg) => seg.text).join("")}
    >
      {segments.map((seg) => (
        <span
          key={seg.id}
          className="truncate whitespace-pre"
          style={{
            color: seg.tone === "primary" ? theme.text : theme.textMuted,
            opacity: seg.tone === "primary" ? 1 : 0.75,
          }}
        >
          {seg.text}
        </span>
      ))}
    </span>
  );
}

function HintsTrigger({
  hint,
  version,
}: {
  hint: string;
  version: string;
}) {
  const empty = hint.trim() === "";
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        aria-label="Show keybind hints"
        className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-full transition-[background-color,opacity,color] duration-150 ease-out"
        style={{ color: theme.textMuted, opacity: 0.55 }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = `color-mix(in oklab, ${theme.text} 8%, transparent)`;
          e.currentTarget.style.opacity = "1";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = "transparent";
          e.currentTarget.style.opacity = "0.55";
        }}
      >
        <svg
          width="11"
          height="11"
          viewBox="0 0 11 11"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <circle cx="5.5" cy="5.5" r="4.2" />
          <path d="M4.2 4.2 c0.4 -1 1.6 -1 2.1 -0.4 c0.5 0.6 0 1.2 -0.5 1.6 c-0.4 0.3 -0.6 0.7 -0.6 1.1" />
          <circle cx="5.5" cy="8.2" r="0.35" fill="currentColor" stroke="none" />
        </svg>
      </button>

      <div
        role="tooltip"
        className="pointer-events-none absolute right-0 bottom-[calc(100%+8px)] z-[80] w-[280px] origin-bottom-right scale-[0.96] opacity-0 transition-[opacity,transform] duration-150 ease-out group-hover:pointer-events-auto group-hover:scale-100 group-hover:opacity-100"
        style={{
          backgroundColor: theme.background,
          border: `1px solid ${theme.border}`,
          borderRadius: 10,
          boxShadow:
            "0 10px 30px -10px rgb(0 0 0 / 0.35), 0 2px 6px -2px rgb(0 0 0 / 0.25)",
        }}
      >
        <div className="flex flex-col gap-2 p-3">
          {empty ? (
            <span
              className="chrome-meta italic"
              style={{ color: theme.textMuted }}
            >
              No hints in this mode
            </span>
          ) : (
            <span
              className="chrome-meta leading-relaxed whitespace-normal break-words"
              style={{ color: theme.text }}
            >
              {hint}
            </span>
          )}
          <div
            className="-mx-3 mt-1 border-t pt-2 pr-3 pl-3 text-right"
            style={{ borderColor: theme.border }}
          >
            <span
              className="chrome-code"
              style={{ color: theme.textMuted, opacity: 0.6 }}
            >
              aimux v{version}
            </span>
          </div>
        </div>
      </div>
    </span>
  );
}

export function StatusBar({
  projection,
  connecting,
  onOpenUsage,
}: {
  projection: AppStateProjection;
  connecting: boolean;
  onOpenUsage: () => void;
}) {
  const { statusBar, aiUsage, focusMode } = projection;

  return (
    <div
      className="relative z-[60] flex h-8 shrink-0 items-center gap-3 overflow-visible px-3"
      style={{ backgroundColor: theme.backgroundPanel }}
    >
      <div className="flex shrink-0 items-center gap-2">
        <ConnectionDot connecting={connecting} />
        <ModeLabel focusMode={focusMode} />
      </div>

      <div className="h-3 w-px shrink-0" style={{ backgroundColor: theme.border, opacity: 0.6 }} />

      <ProjectBreadcrumb segments={statusBar.projectSegments} />

      <div className="flex-1" />

      <div className="flex shrink-0 items-center gap-3">
        <span className="font-mono">
          <AIUsageIndicator aiUsage={aiUsage} onOpen={onOpenUsage} />
        </span>
        <HintsTrigger hint={statusBar.right} version={statusBar.version} />
      </div>
    </div>
  );
}
