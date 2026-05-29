import { theme } from "@/lib/theme";
import type { ProjectedTab } from "@/lib/types";

import { Spinner } from "./Spinner";
import { AimuxButton } from "./ui/AimuxButton";

interface SidebarProps {
  sessionName: string | null;
  branch: string | null;
  worktreeCount: number;
  tabs: ProjectedTab[];
  activeTabId: string | null;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewTab: () => void;
  onOpenWorktreeMove?: () => void;
}

function Activity({ tab }: { tab: ProjectedTab }) {
  if (tab.activity === "working") {
    return (
      <span style={{ color: theme.primary }}>
        <Spinner color={theme.primary} /> working
      </span>
    );
  }
  if (tab.activity === "waiting-input") {
    return <span style={{ color: theme.warning }}>? waiting</span>;
  }
  if (tab.activity === "idle") {
    return <span style={{ color: theme.success }}>● idle</span>;
  }
  return null;
}

export function Sidebar({
  sessionName,
  branch,
  worktreeCount,
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onNewTab,
  onOpenWorktreeMove,
}: SidebarProps) {
  const moveDisabled = worktreeCount < 2;
  return (
    <div
      className="flex h-full w-56 shrink-0 flex-col overflow-hidden border-r font-mono text-xs"
      style={{ backgroundColor: theme.background, borderColor: theme.border }}
    >
      <div className="flex flex-col gap-0.5 px-3 pt-2 pb-1">
        <span className="font-bold" style={{ color: theme.text }}>
          aimux
        </span>
        <span className="truncate" style={{ color: theme.textMuted }}>
          {sessionName ?? "No workspace selected"}
        </span>
        {branch !== null && branch !== "" ? (
          <span className="truncate" style={{ color: theme.textMuted }}>
            ⎇ {branch}
          </span>
        ) : null}
        <div className="mt-1.5 flex gap-1">
          <AimuxButton
            className="flex-1 px-2 py-1 text-left"
            onClick={onNewTab}
            tone="panel"
          >
            + New assistant
          </AimuxButton>
          <AimuxButton
            className="px-2 py-1 text-left"
            onClick={moveDisabled ? undefined : onOpenWorktreeMove}
            style={moveDisabled ? { opacity: 0.4, pointerEvents: "none" } : undefined}
            tone="panel"
          >
            ↗ Move
          </AimuxButton>
        </div>
      </div>

      <div className="px-3 py-1 select-none" style={{ color: theme.textMuted }}>
        {"·".repeat(26)}
      </div>

      <div className="flex-1 overflow-y-auto">
        {tabs.map((tab) => {
          const active = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              onMouseDown={() => onSelectTab(tab.id)}
              className="group flex cursor-pointer flex-col px-3 py-1"
              style={{ backgroundColor: active ? theme.backgroundElement : "transparent" }}
            >
              <div className="flex items-center">
                <span className="w-3" style={{ color: theme.primary }}>
                  {active ? "›" : " "}
                </span>
                <span
                  className="flex-1 truncate"
                  style={{ color: active ? theme.text : theme.textMuted }}
                >
                  {tab.title}
                </span>
                <AimuxButton
                  className="px-1 opacity-0 group-hover:opacity-100"
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    onCloseTab(tab.id);
                  }}
                  variant="ghost"
                >
                  ×
                </AimuxButton>
              </div>
              <div className="flex items-center gap-2 pl-3" style={{ color: theme.textMuted }}>
                <span className="truncate">{tab.command.split(" ")[0]}</span>
                <Activity tab={tab} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
