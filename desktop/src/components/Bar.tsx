import type { BarLite } from "@aimux/gui-protocol";

import { theme } from "@/lib/theme";

interface BarProps {
  bar: BarLite;
  side: "left" | "right";
  /** Element to render per widget id. A widget with no element is skipped. */
  widgets: Record<string, React.ReactNode>;
}

/**
 * One flanking bar. Widgets are stacked top → bottom in the order the host
 * sends them, sharing the height by their `grow` weight — the same model as
 * the TUI's `Bar`, which is why the git panel is no longer a pane with a
 * position of its own.
 *
 * ponytail: `bar.width` is a terminal column count, rendered here as `ch`.
 * Good enough while the chrome is monospace; give the bar its own px width if
 * that ever stops being true.
 */
export function Bar({ bar, side, widgets }: BarProps) {
  const visible = bar.widgets.filter(
    (w) => w.visible && widgets[w.id] !== undefined,
  );
  if (!bar.visible || visible.length === 0) return null;

  return (
    <div
      className="flex min-h-0 shrink-0 flex-col"
      style={{
        backgroundColor: theme.backgroundPanel,
        [side === "left" ? "borderRight" : "borderLeft"]:
          `1px solid ${theme.border}`,
        width: `${bar.width}ch`,
      }}
    >
      {visible.map((widget) => (
        <div
          key={widget.id}
          className="min-h-0 overflow-hidden"
          style={{ flexBasis: 0, flexGrow: widget.grow }}
        >
          {widgets[widget.id]}
        </div>
      ))}
    </div>
  );
}
