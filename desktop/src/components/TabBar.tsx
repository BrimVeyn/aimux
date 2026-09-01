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

import { Button } from "@/components/ui/button";
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
 * Transcription of `src/ui/components/layout/top-tab-bar.tsx`: one row tall,
 * the active workspace's tabs, splits collapsed into one entry. Same
 * indicators, same `[N]` range, same drag-to-reorder — and it calls the host's
 * own `buildTabEntries` / `filterTabsForActiveWorkspace` so the two strips
 * cannot disagree about what an entry is.
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
      className="tui tui-row w-full overflow-x-auto overflow-y-hidden"
      style={{ backgroundColor: theme.backgroundPanel }}
    >
      {visibleEntries.map((entry, index) => {
        // `[N]` only for the first nine — that is the range Leader+1..9 can
        // address, and a label you cannot type is noise.
        const indexLabel = index < 9 ? `[${index + 1}]` : null;
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
      {/* Not while a full-screen view is up: a `+` that quietly starts a tab
          and drops you out of the screen you were reading is noise, and on the
          settings screen it is not even about anything on it. */}
      {panesReplaced ? null : (
        <Button
          variant="ghost"
          size="tui"
          aria-label="New tab"
          title="New tab"
          onClick={onNew}
          style={{ color: theme.textMuted }}
        >
          +
        </Button>
      )}
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
  indexLabel: string | null;
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onDragStart: (entryId: string) => void;
  onDragEnter: (entryId: string) => void;
  onDragEnd: () => void;
}) {
  const targetTabId =
    entry.kind === "single" ? entry.tab.id : entry.activeLeafId;
  const closeEntry = useCallback(() => {
    if (entry.kind === "single") {
      onClose(entry.tab.id);
      return;
    }
    for (const tab of entry.tabs) onClose(tab.id);
  }, [entry, onClose]);

  const indicator =
    entry.kind === "group"
      ? groupIndicator(active, focused)
      : tabIndicator(active, focused);
  const indicatorColor =
    entry.kind === "group"
      ? groupIndicatorColor(active, focused)
      : tabIndicatorColor(active, focused);

  return (
    // The row is the drag source and carries the active background; the two
    // targets on it are siblings, so each gets the strip's full height as its
    // hitbox instead of the width of its glyph.
    <span
      draggable
      onDragStart={() => onDragStart(entry.id)}
      onDragEnter={() => onDragEnter(entry.id)}
      onDragOver={(e) => e.preventDefault()}
      onDragEnd={onDragEnd}
      onDrop={onDragEnd}
      className="flex h-full shrink-0 items-center"
      style={{
        backgroundColor:
          active || dragging ? theme.backgroundElement : "transparent",
      }}
    >
      <Button
        variant="ghost"
        size="tui"
        aria-current={active ? "true" : undefined}
        onClick={() => onActivate(targetTabId)}
        className="pr-0"
      >
        <span style={{ color: indicatorColor }}>{indicator} </span>
        {indexLabel !== null ? (
          <span style={{ color: theme.textMuted }}>{indexLabel} </span>
        ) : null}

        {entry.kind === "single" ? (
          <>
            <span style={{ color: active ? theme.text : theme.textMuted }}>
              {entry.tab.title}
            </span>
            <ActivityGlyph tab={entry.tab} />
          </>
        ) : (
          entry.tabs.map((tab, i) => (
            <span key={tab.id}>
              {i > 0 ? (
                <span style={{ color: theme.textMuted }}> | </span>
              ) : null}
              <span
                style={{
                  color:
                    tab.id === entry.activeLeafId ? theme.text : theme.textMuted,
                }}
              >
                {tab.title}
              </span>
            </span>
          ))
        )}
      </Button>
      <Button
        variant="ghost"
        size="tui"
        aria-label="Close tab"
        title="Close tab"
        onClick={closeEntry}
        style={{ color: theme.textMuted }}
      >
        ×
      </Button>
    </span>
  );
}

function tabIndicator(active: boolean, focused: boolean): string {
  if (!active) return " ";
  return focused ? "›" : "•";
}

function tabIndicatorColor(active: boolean, focused: boolean): string {
  if (!active) return theme.textMuted;
  return focused ? theme.primary : theme.text;
}

function groupIndicator(active: boolean, focused: boolean): string {
  if (!active) return "·";
  return focused ? "›" : "•";
}

function groupIndicatorColor(active: boolean, focused: boolean): string {
  if (!active) return theme.textMuted;
  return focused ? theme.primary : theme.text;
}

/**
 * One marker, always two cells wide so a tab never resizes when its agent
 * starts or stops. Nothing for a plain idle tab: "not busy" is the resting
 * state of every tab you are not watching, so a mark that is always on cannot
 * also mean "this one rang".
 */
function ActivityGlyph({ tab }: { tab: ProjectedTab }) {
  if (tab.status === "error") return <Cell color={theme.error}>✗</Cell>;
  if (tab.status === "disconnected")
    return <Cell color={theme.warning}>⏸</Cell>;
  if (tab.activity === "working") {
    return (
      <span className="inline-flex w-[2ch] justify-end">
        <Spinner color={theme.primary} />
      </span>
    );
  }
  if (tab.activity === "waiting-input")
    return <Cell color={theme.warning}>?</Cell>;
  if (tab.unseen === true) return <Cell color={theme.success}>●</Cell>;
  return <span className="w-[2ch]"> </span>;
}

function Cell({
  children,
  color,
}: {
  color: string;
  children: React.ReactNode;
}) {
  return <span style={{ color }}> {children}</span>;
}
