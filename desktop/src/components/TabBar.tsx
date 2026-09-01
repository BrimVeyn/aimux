import { useCallback, useMemo, useRef, useState } from "react";

import type {
  LayoutNode,
  ProjectedTab,
  ProjectRecordLite,
} from "@aimux/gui-protocol";

import {
  buildTabEntries,
  filterTabsForActiveWorkspace,
  type TabEntry,
} from "@aimux/state/tab-entries";

import { theme } from "@/lib/theme";

import { Spinner } from "./Spinner";

interface TabBarProps {
  tabs: ProjectedTab[];
  activeTabId: string | null;
  project: ProjectRecordLite | undefined;
  layoutTrees: Record<string, LayoutNode>;
  tabGroupMap: Record<string, string>;
  focused: boolean;
  /** A full-screen view replaced the panes: show the strip, drop the `+`. */
  panesReplaced?: boolean;
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onNew: () => void;
  onReorder: (orderedTabIds: string[]) => void;
}

/**
 * The strip above the panes: the ACTIVE workspace's tabs, splits collapsed into
 * a single entry. Mirrors `src/ui/components/layout/top-tab-bar.tsx` — same
 * entries, same `[N]` range, same drag-to-reorder — by calling the same two
 * host functions rather than restating the rules here.
 */
export function TabBar({
  activeTabId,
  focused,
  layoutTrees,
  onActivate,
  onClose,
  onNew,
  onReorder,
  panesReplaced = false,
  project,
  tabGroupMap,
  tabs,
}: TabBarProps) {
  const entries = useMemo(
    () =>
      buildTabEntries(
        filterTabsForActiveWorkspace(tabs, project),
        layoutTrees,
        tabGroupMap,
        activeTabId,
      ),
    [activeTabId, layoutTrees, project, tabGroupMap, tabs],
  );

  const baselineOrder = useMemo(() => entries.map((e) => e.id), [entries]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOrder, setDragOrder] = useState<string[] | null>(null);
  const movedRef = useRef(false);

  const visibleEntries = useMemo(() => {
    if (dragOrder === null) return entries;
    const byId = new Map(entries.map((e) => [e.id, e]));
    return dragOrder
      .map((id) => byId.get(id))
      .filter((e): e is TabEntry<ProjectedTab> => e !== undefined);
  }, [dragOrder, entries]);

  const handleDragEnter = useCallback(
    (overId: string) => {
      if (draggingId === null || overId === draggingId) return;
      movedRef.current = true;
      setDragOrder((prev) => {
        const order = prev ?? baselineOrder;
        const from = order.indexOf(draggingId);
        const to = order.indexOf(overId);
        if (from < 0 || to < 0) return order;
        const next = [...order];
        next.splice(to, 0, ...next.splice(from, 1));
        return next;
      });
    },
    [baselineOrder, draggingId],
  );

  const commitDrop = useCallback(() => {
    const order = dragOrder;
    const moved = movedRef.current;
    setDraggingId(null);
    setDragOrder(null);
    movedRef.current = false;
    if (!moved || order === null) return;
    // Expand entries back to a flat tab-id order: a group entry stands for
    // every leaf inside it, and the reducer rewrites slots per tab.
    const byId = new Map(entries.map((e) => [e.id, e]));
    onReorder(
      order.flatMap((id) => {
        const entry = byId.get(id);
        if (entry === undefined) return [];
        return entry.kind === "single"
          ? [entry.tab.id]
          : entry.tabs.map((t) => t.id);
      }),
    );
  }, [dragOrder, entries, onReorder]);

  return (
    <div
      className="relative z-[60] flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-b px-3"
      style={{
        backgroundColor: theme.backgroundPanel,
        borderColor: theme.border,
      }}
    >
      {visibleEntries.map((entry, index) => {
        // `[N]` only for the first nine — that is the range Leader+1..9 can
        // address, and a label you cannot type is noise.
        const indexLabel = index < 9 ? index + 1 : null;
        const isActive =
          entry.kind === "single"
            ? entry.tab.id === activeTabId
            : entry.tabs.some((t) => t.id === activeTabId);
        return (
          <TabCell
            key={entry.id}
            active={isActive}
            dragging={entry.id === draggingId}
            entry={entry}
            focused={focused}
            indexLabel={indexLabel}
            onActivate={onActivate}
            onClose={onClose}
            onDragEnd={commitDrop}
            onDragEnter={handleDragEnter}
            onDragStart={setDraggingId}
          />
        );
      })}
      <div className="flex-1" />
      {/* Not while a full-screen view is up: a `+` that quietly starts a tab
          and drops you out of the screen you were reading is noise. */}
      {panesReplaced ? null : <NewTabButton onClick={onNew} />}
    </div>
  );
}

function TabCell({
  active,
  dragging,
  entry,
  focused,
  indexLabel,
  onActivate,
  onClose,
  onDragEnd,
  onDragEnter,
  onDragStart,
}: {
  entry: TabEntry<ProjectedTab>;
  active: boolean;
  dragging: boolean;
  focused: boolean;
  indexLabel: number | null;
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onDragStart: (entryId: string) => void;
  onDragEnter: (entryId: string) => void;
  onDragEnd: () => void;
}) {
  const targetTabId =
    entry.kind === "single" ? entry.tab.id : entry.activeLeafId;
  const closeAll = useCallback(() => {
    if (entry.kind === "single") {
      onClose(entry.tab.id);
      return;
    }
    for (const tab of entry.tabs) onClose(tab.id);
  }, [entry, onClose]);

  return (
    <div
      draggable
      onDragStart={() => onDragStart(entry.id)}
      onDragEnter={() => onDragEnter(entry.id)}
      onDragOver={(e) => e.preventDefault()}
      onDragEnd={onDragEnd}
      onDrop={onDragEnd}
      onMouseDown={() => onActivate(targetTabId)}
      title={
        entry.kind === "single"
          ? entry.tab.title
          : entry.tabs.map((t) => t.title).join(" | ")
      }
      className="group relative flex shrink-0 cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5 transition-[background-color,opacity] duration-150 ease-out"
      style={{
        backgroundColor:
          active || dragging ? theme.backgroundElement : "transparent",
        opacity: dragging ? 0.6 : 1,
      }}
    >
      {active ? (
        <span
          aria-hidden
          className="pointer-events-none absolute top-0 right-3 left-3 h-[1.5px] rounded-full"
          style={{ backgroundColor: focused ? theme.primary : theme.text }}
        />
      ) : null}

      {indexLabel !== null ? (
        <span className="chrome-code" style={{ color: theme.textMuted }}>
          {indexLabel}
        </span>
      ) : null}

      {entry.kind === "single" ? (
        <TabLabel tab={entry.tab} active={active} />
      ) : (
        entry.tabs.map((tab, i) => (
          <span key={tab.id} className="flex items-center">
            {i > 0 ? (
              <span
                className="chrome-label px-1"
                style={{ color: theme.textMuted }}
              >
                |
              </span>
            ) : null}
            <TabLabel tab={tab} active={tab.id === entry.activeLeafId} />
          </span>
        ))
      )}

      <button
        type="button"
        aria-label="Close tab"
        onMouseDown={(e) => {
          e.stopPropagation();
          closeAll();
        }}
        className="flex h-[18px] w-[18px] scale-90 items-center justify-center rounded-full opacity-0 transition-[opacity,background-color,transform] duration-150 ease-out group-hover:opacity-100 hover:scale-100"
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
          width="10"
          height="10"
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
  );
}

/** Title plus the one glyph that says what the tab is doing. */
function TabLabel({ active, tab }: { tab: ProjectedTab; active: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <ActivityGlyph tab={tab} />
      <span
        className="chrome-label max-w-[180px] truncate"
        style={{ color: active ? theme.text : theme.textMuted }}
      >
        {tab.title}
      </span>
    </span>
  );
}

function ActivityGlyph({ tab }: { tab: ProjectedTab }) {
  if (tab.status === "error") {
    return <Glyph color={theme.error}>✗</Glyph>;
  }
  if (tab.status === "disconnected") {
    return <Glyph color={theme.warning}>⏸</Glyph>;
  }
  if (tab.activity === "working") {
    return (
      <span className="inline-flex h-2 w-2 items-center justify-center">
        <Spinner color={theme.primary} />
      </span>
    );
  }
  if (tab.activity === "waiting-input") {
    return <Glyph color={theme.warning}>?</Glyph>;
  }
  // Nothing for a plain idle tab, on purpose: "not busy" is the resting state
  // of every tab you are not watching, so a dot that is always lit cannot also
  // mean "this one rang".
  if (tab.unseen === true) {
    return <Glyph color={theme.success}>●</Glyph>;
  }
  return null;
}

function Glyph({
  children,
  color,
}: {
  color: string;
  children: React.ReactNode;
}) {
  return (
    <span aria-hidden className="chrome-code" style={{ color }}>
      {children}
    </span>
  );
}

function NewTabButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onMouseDown={onClick}
      aria-label="New tab"
      className="group flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 transition-[background-color,color] duration-150 ease-out"
      style={{ color: theme.textMuted }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = theme.backgroundElement;
        e.currentTarget.style.color = theme.text;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = "transparent";
        e.currentTarget.style.color = theme.textMuted;
      }}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      >
        <path d="M6 2 L6 10 M2 6 L10 6" />
      </svg>
      <span className="chrome-label">New tab</span>
    </button>
  );
}
