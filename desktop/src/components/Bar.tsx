import type { BarLite, GuiIntent } from "@aimux/gui-protocol";

import type { BarMenuItem, BarsShape } from "@aimux/state/bar-menu";
import {
  buildBarContextMenu,
  buildWidgetContextMenu,
} from "@aimux/state/bar-menu";

import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { theme } from "@/lib/theme";

type MenuAction = Extract<GuiIntent, { kind: "bar.menuAction" }>["action"];

interface BarProps {
  bar: BarLite;
  /** Both bars — the menus offer moving a widget across and unhiding one. */
  bars: BarsShape;
  side: "left" | "right";
  onMenuAction: (action: MenuAction) => void;
  /** Element to render per widget id. A widget with no element is skipped. */
  widgets: Record<string, React.ReactNode>;
  onOpenSettings: () => void;
  onOpenStats: () => void;
}

/**
 * Transcription of `src/ui/components/layout/bar.tsx`. One edge bar hosting a
 * vertical stack of widgets, each taking its share of the height by `grow`,
 * with a rule between them. A one-cell edge in the border colour faces the
 * terminal — the bar's own width includes it, which is why the content is one
 * cell narrower than `bar.width`.
 *
 * ponytail: the edge is drawn but not draggable, and the rules between widgets
 * do not resize either. Wire them to the same resize dispatches the TUI uses
 * when the sizes need to be adjustable from here.
 */
export function Bar({
  bar,
  bars,
  onMenuAction,
  onOpenSettings,
  onOpenStats,
  side,
  widgets,
}: BarProps) {
  const visible = bar.widgets.filter(
    (w) => w.visible && widgets[w.id] !== undefined,
  );
  if (!bar.visible || visible.length === 0) return null;

  const edge = (
    <span
      aria-hidden
      className="w-[1ch] shrink-0"
      style={{ backgroundColor: theme.border }}
    />
  );

  return (
    <div
      className="tui flex min-h-0 shrink-0 flex-row overflow-hidden"
      style={{
        backgroundColor: theme.background,
        // `bar.width` is a terminal column count and one of those columns is
        // the edge, exactly as the TUI measures it.
        width: `${bar.width}ch`,
      }}
    >
      {side === "right" ? edge : null}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {visible.map((widget, index) => (
            <div
              key={widget.id}
              className="flex min-h-0 flex-col overflow-hidden"
              style={{ flexBasis: 0, flexGrow: widget.grow }}
            >
              <Menu
                className="flex min-h-0 flex-1 flex-col overflow-hidden"
                items={buildWidgetContextMenu(bars, side, widget.id)}
                onAction={onMenuAction}
              >
                {widgets[widget.id]}
              </Menu>
              {index === visible.length - 1 ? null : <Rule />}
            </div>
          ))}
        </div>
        {side === "left" ? (
          <Menu
            className="shrink-0"
            items={buildBarContextMenu(bars, side)}
            onAction={onMenuAction}
          >
            <BarFooter
              onOpenSettings={onOpenSettings}
              onOpenStats={onOpenStats}
            />
          </Menu>
        ) : null}
      </div>
      {side === "left" ? edge : null}
    </div>
  );
}

function Rule() {
  return (
    <div
      className="tui-row overflow-hidden"
      style={{ color: theme.border }}
      aria-hidden
    >
      {"─".repeat(400)}
    </div>
  );
}

/**
 * U+2699, not the nerd-font gear: its Emoji_Presentation is No, so it draws
 * text-style in one cell and no font has to be installed for the one button
 * that opens the settings. U+25A4 is chosen on the same rule.
 */
const SETTINGS_LABEL = "⚙ Settings";
const STATS_LABEL = "▤ Stats";

/**
 * The bar's bottom bar: settings and stats, pinned under every widget in the
 * column rather than living inside whichever widget happens to be last. These
 * are the only full-screen views the panes step aside for that a mouse can
 * reach at all, so they need a slot that is on screen whenever the bar is.
 */
function BarFooter({
  onOpenSettings,
  onOpenStats,
}: {
  onOpenSettings: () => void;
  onOpenStats: () => void;
}) {
  return (
    <div className="flex shrink-0 flex-col">
      <Rule />
      {/* Two buttons rather than one string: the whole footer as a single
          target is what the TUI avoids with its spacer box. */}
      <div className="tui-row">
        <Button
          variant="ghost"
          size="tui"
          onClick={onOpenSettings}
          style={{ color: theme.textMuted }}
        >
          {SETTINGS_LABEL}
        </Button>
        <Button
          variant="ghost"
          size="tui"
          onClick={onOpenStats}
          style={{ color: theme.textMuted }}
        >
          {STATS_LABEL}
        </Button>
      </div>
    </div>
  );
}

/**
 * A right-click menu over `children`, built from the shared descriptors.
 *
 * The trigger needs a real element to attach to, so it becomes a box in the
 * layout — which means the caller has to say how that box participates. It had
 * a hardcoded `flex-1` here, and the footer's copy then competed with the
 * widget body for the column's height and took half of it.
 */
function Menu({
  children,
  className,
  items,
  onAction,
}: {
  items: BarMenuItem[];
  onAction: (action: MenuAction) => void;
  className: string;
  children: React.ReactNode;
}) {
  if (items.length === 0) return <>{children}</>;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className={className}>{children}</div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {items.map((item) => (
          <ContextMenuItem
            key={item.label}
            onSelect={() => onAction(item.action)}
          >
            {item.label}
          </ContextMenuItem>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}
