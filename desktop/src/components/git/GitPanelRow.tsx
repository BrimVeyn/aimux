import type { MouseEvent, ReactNode } from "react";

import type { GitTreeFileRow, GitTreeFolderRow } from "@aimux/state/git-tree";

import { theme } from "@/lib/theme";
import type { GitFileEntryLite } from "@/lib/types";

import { type GitFileStatus, statusColor, statusGlyph } from "./git-status-colors";

/**
 * Rows of the git file list, transcribed from `src/ui/components/git/git-panel.tsx`.
 * Every one of them is a single terminal row: a status letter in two cells, a
 * label, and the churn on the right. Selection is a background, and depth is
 * two cells per level — no badges, no rails, no rounded anything.
 */

/** Nerd-font folder glyphs, open and closed. */
const FOLDER_GLYPH = { closed: "", open: "" };

function padStart(value: number | null, width: number): string {
  return String(value ?? 0).padStart(width, " ");
}

export function SectionHeader({
  count,
  title,
}: {
  count: number;
  title: string;
}): ReactNode {
  return (
    <div className="tui-row px-[1ch] font-bold" style={{ color: theme.text }}>
      {title} ({count})
    </div>
  );
}

export function FolderRow({
  isSelected,
  onToggleFolder,
  row,
}: {
  isSelected: boolean;
  onToggleFolder?: (key: string) => void;
  row: GitTreeFolderRow;
}): ReactNode {
  const handleClick = (e: MouseEvent<HTMLDivElement>): void => {
    if (onToggleFolder === undefined) return;
    e.preventDefault();
    onToggleFolder(row.key);
  };
  return (
    <div
      className="tui-row gap-[1ch] px-[1ch]"
      onClick={handleClick}
      title={row.isCollapsed ? "Click to expand" : "Click to collapse"}
      style={{
        backgroundColor: isSelected ? theme.backgroundElement : "transparent",
        cursor: onToggleFolder === undefined ? undefined : "pointer",
        paddingLeft: `${row.depth * 2 + 1}ch`,
      }}
    >
      <span style={{ color: theme.textMuted }}>
        {row.isCollapsed ? "▸" : "▾"}
      </span>
      <span style={{ color: theme.textMuted }}>
        {row.isCollapsed ? FOLDER_GLYPH.closed : FOLDER_GLYPH.open}
      </span>
      <span className="truncate" style={{ color: theme.textMuted }}>
        {row.name}
      </span>
    </div>
  );
}

export function FileRow({
  addedW,
  diffCountEnabled,
  fileListMode,
  isSelected,
  onDoubleClickStage,
  onDoubleClickUnstage,
  removedW,
  row,
}: {
  addedW: number;
  diffCountEnabled: boolean;
  fileListMode: "flat" | "tree";
  isSelected: boolean;
  onDoubleClickStage?: (path: string) => void;
  onDoubleClickUnstage?: (path: string) => void;
  removedW: number;
  row: GitTreeFileRow;
}): ReactNode {
  const file = row.file as GitFileEntryLite;
  const isUntracked = file.section === "untracked";
  const glyph = statusGlyph(file.status as GitFileStatus, isUntracked);
  const hasNumstat = file.added != null || file.removed != null;
  const { basename, prefix } = splitPath(file.path);
  const dir = stripTrailingSlash(prefix);
  const showDir = fileListMode === "flat" && dir !== "";
  const isStaged = file.section === "staged";
  const isToggleable =
    file.section === "staged" ||
    file.section === "unstaged" ||
    file.section === "untracked";

  const handleDoubleClick = (e: MouseEvent<HTMLDivElement>): void => {
    if (!isToggleable) return;
    e.preventDefault();
    if (isStaged) onDoubleClickUnstage?.(file.path);
    else onDoubleClickStage?.(file.path);
  };

  return (
    <div
      className="tui-row gap-[1ch] pr-[1ch] pl-[1ch]"
      onDoubleClick={handleDoubleClick}
      title={
        isStaged
          ? "Double-click to unstage"
          : isToggleable
            ? "Double-click to stage"
            : undefined
      }
      style={{
        backgroundColor: isSelected ? theme.backgroundElement : "transparent",
      }}
    >
      {/* Two cells, centred — the letter never widens the column. */}
      <span
        className="w-[2ch] shrink-0 text-center font-bold"
        style={{ color: statusColor(file.status as GitFileStatus) }}
      >
        {glyph}
      </span>
      <span
        className="min-w-0 flex-1 truncate"
        style={{
          paddingLeft: fileListMode === "tree" ? `${row.depth * 2}ch` : 0,
        }}
      >
        <span style={{ color: theme.text }}>{basename}</span>
        {showDir ? <span style={{ color: theme.textMuted }}> {dir}</span> : null}
      </span>
      {diffCountEnabled ? (
        hasNumstat ? (
          <span className="shrink-0">
            <span style={{ color: theme.diffAdded }}>
              +{padStart(file.added ?? null, addedW)}
            </span>{" "}
            <span style={{ color: theme.diffRemoved }}>
              −{padStart(file.removed ?? null, removedW)}
            </span>
          </span>
        ) : (
          <span className="shrink-0" style={{ color: theme.textMuted }}>
            —
          </span>
        )
      ) : null}
    </div>
  );
}

function splitPath(path: string): { prefix: string; basename: string } {
  const slash = path.lastIndexOf("/");
  if (slash < 0) return { basename: path, prefix: "" };
  return { basename: path.slice(slash + 1), prefix: path.slice(0, slash + 1) };
}

function stripTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
