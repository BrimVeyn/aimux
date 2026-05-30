import type { MouseEvent, ReactNode } from "react";

import type { GitTreeFileRow, GitTreeFolderRow } from "@aimux/state/git-tree";

import { theme } from "@/lib/theme";
import type { GitFileEntryLite } from "@/lib/types";

import { type GitFileStatus, statusColor, statusGlyph } from "./git-status-colors";

interface SectionHeaderProps {
  count: number;
  fileListMode: "flat" | "tree";
  showListModeToggle: boolean;
  title: string;
}

// Mirrors the section header row (~line 295 in src/ui/components/git/git-panel.tsx).
export function SectionHeader({
  count,
  fileListMode,
  showListModeToggle,
  title,
}: SectionHeaderProps): ReactNode {
  return (
    <div
      className="flex items-center justify-between"
      style={{ color: theme.text, paddingRight: "0.5ch" }}
    >
      <span className="font-bold">
        {title} ({count})
      </span>
      {showListModeToggle ? (
        <span className="flex gap-[1ch]">
          <span style={{ color: fileListMode === "tree" ? theme.primary : theme.textMuted }}>
            tree
          </span>
          <span style={{ color: theme.textMuted }}>|</span>
          <span style={{ color: fileListMode === "flat" ? theme.primary : theme.textMuted }}>
            flat
          </span>
        </span>
      ) : null}
    </div>
  );
}

interface FolderRowProps {
  isSelected: boolean;
  onToggleFolder?: (key: string) => void;
  row: GitTreeFolderRow;
}

// Mirrors FolderRow (~line 170). Click toggles collapse via the
// `git.toggleFolder` intent, matching the TUI's onMouseDown chevron.
export function FolderRow({ isSelected, onToggleFolder, row }: FolderRowProps): ReactNode {
  const bg = isSelected ? theme.backgroundElement : undefined;
  const handleClick = (e: MouseEvent<HTMLDivElement>): void => {
    if (onToggleFolder === undefined) return;
    e.preventDefault();
    onToggleFolder(row.key);
  };
  const title = row.isCollapsed ? "Click to expand" : "Click to collapse";
  // The TUI prepends a row marker (›/space) via selection bg only; the GUI keeps
  // parity by tinting the bg the same way (no extra glyph for folders).
  return (
    <div
      className="flex items-center gap-[1ch] whitespace-nowrap"
      onClick={onToggleFolder !== undefined ? handleClick : undefined}
      style={{
        backgroundColor: bg,
        cursor: onToggleFolder !== undefined ? "pointer" : undefined,
        paddingLeft: `${row.depth * 2}ch`,
      }}
      title={onToggleFolder !== undefined ? title : undefined}
    >
      <span style={{ color: theme.textMuted }}>{row.isCollapsed ? "▸" : "▾"}</span>
      <span style={{ color: theme.textMuted }}>{row.isCollapsed ? "" : ""}</span>
      <span className="overflow-hidden text-ellipsis" style={{ color: theme.textMuted }}>
        {row.name}
      </span>
    </div>
  );
}

interface FileRowProps {
  addedW: number;
  diffCountEnabled: boolean;
  fileListMode: "flat" | "tree";
  isSelected: boolean;
  onDoubleClickStage?: (path: string) => void;
  onDoubleClickUnstage?: (path: string) => void;
  removedW: number;
  row: GitTreeFileRow;
}

function padStart(value: number | null | undefined, width: number): string {
  return String(value ?? 0).padStart(width, " ");
}

function splitPath(path: string): { basename: string; prefix: string } {
  const slash = path.lastIndexOf("/");
  if (slash < 0) {
    return { basename: path, prefix: "" };
  }
  return { basename: path.slice(slash + 1), prefix: path.slice(0, slash + 1) };
}

function stripTrailingSlash(prefix: string): string {
  return prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
}

// Mirrors FileRow + renderFileLabel + renderDiffCount (~line 100–260). Stage 2a:
// skip the repo-prefix tag (multi-repo disambiguation is a later stage) and the
// renamedFrom path (the wire shape uses `oldPath` which isn't exposed yet).
export function FileRow({
  addedW,
  diffCountEnabled,
  fileListMode,
  isSelected,
  onDoubleClickStage,
  onDoubleClickUnstage,
  removedW,
  row,
}: FileRowProps): ReactNode {
  const file = row.file as GitFileEntryLite;
  const bg = isSelected ? theme.backgroundElement : undefined;
  const isUntracked = file.section === "untracked";
  const glyph = statusGlyph(file.status as GitFileStatus, isUntracked);
  const hasNumstat = file.added != null || file.removed != null;
  const { basename, prefix } = splitPath(file.path);
  const dir = stripTrailingSlash(prefix);
  const showDir = fileListMode === "flat" && dir !== "";
  const depthPad = fileListMode === "tree" ? `${row.depth * 2}ch` : "0";
  // P2.1: double-click toggles staged-ness. `historical` rows are read-only
  // (HEAD~N walk) so we no-op there. Single-click is unchanged (selection
  // remains keyboard-driven for now).
  const isStaged = file.section === "staged";
  const isToggleable =
    file.section === "staged" || file.section === "unstaged" || file.section === "untracked";
  const doubleClickTitle = isStaged
    ? "Double-click to unstage"
    : isToggleable
      ? "Double-click to stage"
      : "";
  const handleDoubleClick = (e: MouseEvent<HTMLDivElement>): void => {
    if (!isToggleable) {
      return;
    }
    // Avoid the browser's double-click text-selection side effect on the row.
    e.preventDefault();
    if (isStaged) {
      onDoubleClickUnstage?.(file.path);
    } else {
      onDoubleClickStage?.(file.path);
    }
  };
  return (
    <div
      className="flex items-center gap-[1ch] whitespace-nowrap"
      onDoubleClick={handleDoubleClick}
      style={{ backgroundColor: bg }}
      title={doubleClickTitle}
    >
      <span
        className="inline-flex w-[2ch] shrink-0 justify-center font-bold"
        style={{ color: statusColor(file.status as GitFileStatus) }}
      >
        {glyph}
      </span>
      <span
        className="min-w-0 flex-1 overflow-hidden text-ellipsis"
        style={{ paddingLeft: depthPad }}
      >
        <span style={{ color: theme.text }}>{basename}</span>
        {showDir ? <span style={{ color: theme.textMuted }}>{" "}{dir}</span> : null}
      </span>
      {diffCountEnabled ? (
        hasNumstat ? (
          <span className="flex shrink-0 gap-[1ch]">
            <span style={{ color: theme.diffAdded }}>{`+${padStart(file.added, addedW)}`}</span>
            <span style={{ color: theme.diffRemoved }}>{`−${padStart(file.removed, removedW)}`}</span>
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
