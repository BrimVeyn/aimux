import { theme } from "@/lib/theme";
import type { FocusMode } from "@/lib/types";

// A peripheral, always-visible indicator of the global focus mode. Lives at
// the very top of <main>, where the eye naturally lands at the seam between
// chrome and content. Differentiation between 'nav' and 'terminal-input'
// comes from opacity + a soft glow rather than pure hue — so it stays
// legible regardless of how close the active theme's `accent` and `primary`
// happen to be.
//
//   terminal-input → full opacity, soft glow, accent color   ("live")
//   navigation     → dim opacity, no glow, primary color     ("idle")
//   modal/edit/git → transparent (those modes own their own overlay)
export function FocusModeRail({ focusMode }: { focusMode: FocusMode }) {
  const isInput = focusMode === "terminal-input";
  const isNav = focusMode === "navigation";
  const visible = isInput || isNav;

  const color = isInput ? theme.accent : theme.primary;
  const opacity = visible ? (isInput ? 1 : 0.4) : 0;
  const glow = isInput ? `0 -1px 8px -1px ${theme.accent}` : "none";

  return (
    <div
      aria-hidden
      className="pointer-events-none h-[2px] shrink-0 transition-[background-color,opacity,box-shadow] duration-[220ms] ease-out"
      style={{
        backgroundColor: color,
        boxShadow: glow,
        opacity,
      }}
    />
  );
}
