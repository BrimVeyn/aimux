import type React from "react";

import { theme } from "@/lib/theme";
import type { ProjectedTab } from "@/lib/types";

import { Spinner } from "./Spinner";

interface SidebarProps {
  sessionName: string | null;
  branch: string | null;
  tabs: ProjectedTab[];
  activeTabId: string | null;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewTab: () => void;
  // Fires before any button inside the sidebar. The shell wires this to
  // leaveInsertMode so any sidebar interaction drops out of terminal-input,
  // including clicks on whitespace / labels that aren't buttons themselves.
  onInteract?: () => void;
  embeddedRatio?: number;
  gitPanelPosition?: "top" | "bottom";
  gitPanelSlot?: React.ReactNode;
}

function ActivityBadge({ tab }: { tab: ProjectedTab }) {
  if (tab.activity === "working") {
    return (
      <span
        className="chrome-meta inline-flex items-center gap-1 rounded-full px-1.5 py-px"
        style={{
          backgroundColor: `color-mix(in oklab, ${theme.primary} 14%, transparent)`,
          color: theme.primary,
        }}
      >
        <Spinner color={theme.primary} />
        <span>working</span>
      </span>
    );
  }
  if (tab.activity === "waiting-input") {
    return (
      <span
        className="chrome-meta inline-flex items-center rounded-full px-1.5 py-px"
        style={{
          backgroundColor: `color-mix(in oklab, ${theme.warning} 14%, transparent)`,
          color: theme.warning,
        }}
      >
        waiting
      </span>
    );
  }
  if (tab.activity === "idle") {
    return (
      <span
        className="chrome-meta inline-flex items-center gap-1 rounded-full px-1.5 py-px"
        style={{
          backgroundColor: `color-mix(in oklab, ${theme.success} 12%, transparent)`,
          color: theme.success,
        }}
      >
        <span
          aria-hidden
          className="inline-block h-1 w-1 rounded-full"
          style={{ backgroundColor: theme.success }}
        />
        idle
      </span>
    );
  }
  return null;
}

export function Sidebar({
  sessionName,
  branch,
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onNewTab,
  onInteract,
  embeddedRatio = 0.4,
  gitPanelPosition,
  gitPanelSlot,
}: SidebarProps) {
  const slotStyle: React.CSSProperties = {
    flexBasis: `${embeddedRatio * 100}%`,
    flexShrink: 0,
    overflow: "auto",
  };
  const showSlotTop = gitPanelSlot !== undefined && gitPanelPosition === "top";
  const showSlotBottom = gitPanelSlot !== undefined && gitPanelPosition === "bottom";

  return (
    <div
      className="relative z-[60] flex h-full w-60 shrink-0 flex-col overflow-hidden border-r"
      style={{ backgroundColor: theme.background, borderColor: theme.border }}
      onMouseDownCapture={onInteract}
    >
      <div className="flex flex-col gap-1 px-4 pt-3 pb-2">
        {sessionName !== null && sessionName !== "" ? (
          <span className="chrome-title truncate" style={{ color: theme.text }}>
            {sessionName}
          </span>
        ) : (
          <span
            className="chrome-meta italic truncate"
            style={{ color: theme.textMuted }}
          >
            No workspace
          </span>
        )}
        {branch !== null && branch !== "" ? (
          <span
            className="chrome-code truncate inline-flex items-center gap-1"
            style={{ color: theme.textMuted }}
          >
            <span aria-hidden>⎇</span>
            <span className="truncate">{branch}</span>
          </span>
        ) : null}
        <NewAssistantButton onClick={onNewTab} />
      </div>

      {showSlotTop ? <div style={slotStyle}>{gitPanelSlot}</div> : null}

      <div className="mt-1 flex-1 overflow-y-auto pb-2">
        {tabs.map((tab) => {
          const active = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              onMouseDown={() => onSelectTab(tab.id)}
              className="group relative flex cursor-pointer flex-col gap-0.5 px-4 py-2 transition-[background-color] duration-150 ease-out"
              style={{
                backgroundColor: active ? theme.backgroundElement : "transparent",
              }}
              onMouseEnter={(e) => {
                if (!active) {
                  e.currentTarget.style.backgroundColor = `color-mix(in oklab, ${theme.backgroundElement} 45%, transparent)`;
                }
              }}
              onMouseLeave={(e) => {
                if (!active) {
                  e.currentTarget.style.backgroundColor = "transparent";
                }
              }}
            >
              {active ? (
                <span
                  aria-hidden
                  className="pointer-events-none absolute top-1.5 bottom-1.5 left-0 w-[2px] rounded-r-full"
                  style={{ backgroundColor: theme.primary }}
                />
              ) : null}

              <div className="flex items-center gap-2">
                <span
                  className="chrome-label flex-1 truncate"
                  style={{ color: active ? theme.text : theme.textMuted }}
                >
                  {tab.title}
                </span>
                <button
                  type="button"
                  aria-label="Close tab"
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    onCloseTab(tab.id);
                  }}
                  className="flex h-4 w-4 items-center justify-center rounded-full opacity-0 transition-[opacity,background-color,color] duration-150 ease-out group-hover:opacity-100"
                  style={{ color: theme.textMuted }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = `color-mix(in oklab, ${theme.error} 18%, transparent)`;
                    e.currentTarget.style.color = theme.text;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = "transparent";
                    e.currentTarget.style.color = theme.textMuted;
                  }}
                >
                  <svg
                    width="8"
                    height="8"
                    viewBox="0 0 10 10"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                  >
                    <path d="M2 2 L8 8 M8 2 L2 8" />
                  </svg>
                </button>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className="chrome-code truncate flex-1"
                  style={{ color: theme.textMuted, opacity: 0.85 }}
                >
                  {tab.command.split(" ")[0]}
                </span>
                <ActivityBadge tab={tab} />
              </div>
            </div>
          );
        })}
      </div>

      {showSlotBottom ? <div style={slotStyle}>{gitPanelSlot}</div> : null}
    </div>
  );
}

function NewAssistantButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-2 flex items-center gap-2 rounded-lg px-3 py-2 transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.99]"
      style={{
        backgroundColor: theme.backgroundPanel,
        color: theme.textMuted,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = theme.backgroundElement;
        e.currentTarget.style.color = theme.text;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = theme.backgroundPanel;
        e.currentTarget.style.color = theme.textMuted;
      }}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      >
        <path d="M7 2.5 L7 11.5 M2.5 7 L11.5 7" />
      </svg>
      <span className="chrome-label">New assistant</span>
    </button>
  );
}
