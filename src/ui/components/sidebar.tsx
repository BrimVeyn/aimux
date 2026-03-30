import type { ScrollBoxRenderable } from "@opentui/core";
import { useEffect, useRef } from "react";

import type { AppState } from "../../state/types";
import { getSidebarScrollTarget } from "./sidebar-scroll";
import { theme } from "../theme";
import { TabItem } from "./tab-item";

interface SidebarProps {
  state: AppState;
}

export function Sidebar({ state }: SidebarProps) {
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);
  const previousActiveIndexRef = useRef(-1);
  const previousVisibilityRef = useRef(state.sidebar.visible);
  const activeIndex = state.tabs.findIndex((tab) => tab.id === state.activeTabId);

  useEffect(() => {
    if (!state.sidebar.visible) {
      previousVisibilityRef.current = false;
      previousActiveIndexRef.current = activeIndex;
      return;
    }

    const scrollbox = scrollRef.current;
    if (!scrollbox) {
      previousVisibilityRef.current = state.sidebar.visible;
      previousActiveIndexRef.current = activeIndex;
      return;
    }

    if (!previousVisibilityRef.current && state.activeTabId) {
      scrollbox.scrollChildIntoView(`sidebar-tab-${state.activeTabId}`);
      previousVisibilityRef.current = true;
      previousActiveIndexRef.current = activeIndex;
      return;
    }

    const scrollTarget = getSidebarScrollTarget({
      previousActiveIndex: previousActiveIndexRef.current,
      nextActiveIndex: activeIndex,
      tabCount: state.tabs.length,
    });

    if (scrollTarget === "top") {
      scrollbox.scrollTo({ x: 0, y: 0 });
    } else if (scrollTarget === "bottom") {
      scrollbox.scrollTo({ x: 0, y: scrollbox.scrollHeight });
    } else if (scrollTarget === "active-item" && state.activeTabId) {
      scrollbox.scrollChildIntoView(`sidebar-tab-${state.activeTabId}`);
    }

    previousVisibilityRef.current = state.sidebar.visible;
    previousActiveIndexRef.current = activeIndex;
  }, [activeIndex, state.activeTabId, state.sidebar.visible, state.tabs.length]);

  if (!state.sidebar.visible) {
    return null;
  }

  return (
    <box
      width={state.sidebar.width}
      border
      borderColor={state.focusMode === "navigation" ? theme.borderActive : theme.border}
      padding={1}
      flexDirection="column"
      backgroundColor={theme.panelMuted}
      gap={1}
    >
      <text fg={theme.accent}>aimux</text>
      <text fg={theme.textMuted}>
        {state.currentSessionId
          ? `Session: ${state.sessions.find((s) => s.id === state.currentSessionId)?.name ?? "unknown"}`
          : "No session selected"}
      </text>
      <scrollbox
        ref={scrollRef}
        flexGrow={1}
        scrollY
        viewportCulling
        contentOptions={{ flexDirection: "column", gap: 1 }}
      >
        {state.tabs.length === 0 ? (
          <box paddingTop={1}>
            <text fg={theme.textMuted}>No tabs yet. Press Ctrl+n.</text>
          </box>
        ) : (
          state.tabs.map((tab) => (
            <TabItem
              key={tab.id}
              id={`sidebar-tab-${tab.id}`}
              tab={tab}
              active={tab.id === state.activeTabId}
              focused={state.focusMode === "navigation"}
              isFocusedInput={tab.id === state.activeTabId && state.focusMode === "terminal-input"}
            />
          ))
        )}
      </scrollbox>
    </box>
  );
}
