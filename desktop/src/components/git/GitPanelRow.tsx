import type { MouseEvent, ReactNode } from "react";

import type { GitTreeFileRow, GitTreeFolderRow } from "@aimux/state/git-tree";

import { Button } from "@/components/ui/button";
import { theme } from "@/lib/theme";
import type { GitFileEntryLite } from "@/lib/types";

import { type GitFileStatus, statusColor, statusGlyph } from "./git-status-colors";

interface SectionHeaderProps {
  count: number;
  title: string;
}

// Quiet section divider: title and a tabular count, separated by a fine dot.
// No chip, no pill — the typography alone carries the hierarchy.
export function SectionHeader({ count, title }: SectionHeaderProps): ReactNode {
  return (
    <div className="flex items-baseline gap-1.5 px-1 py-1">
      <span
        className="chrome-label"
        style={{ color: theme.text, fontWeight: 600 }}
      >
        {title}
      </span>
      <span
        className="chrome-meta tabular-nums"
        style={{ color: theme.textMuted, opacity: 0.7 }}
      >
        {count}
      </span>
    </div>
  );
}

interface FolderRowProps {
  isSelected: boolean;
  onToggleFolder?: (key: string) => void;
  row: GitTreeFolderRow;
}

export function FolderRow({ isSelected, onToggleFolder, row }: FolderRowProps): ReactNode {
  const handleClick = (e: MouseEvent<HTMLButtonElement>): void => {
    if (onToggleFolder === undefined) return;
    e.preventDefault();
    onToggleFolder(row.key);
  };
  const title = row.isCollapsed ? "Click to expand" : "Click to collapse";
  return (
    <Button
      variant="ghost"
      size="tui"
      disabled={onToggleFolder === undefined}
      aria-expanded={!row.isCollapsed}
      className="group relative w-full justify-start gap-1.5 whitespace-nowrap px-1 disabled:opacity-100"
      onClick={onToggleFolder !== undefined ? handleClick : undefined}
      style={{
        backgroundColor: isSelected ? theme.backgroundElement : "transparent",
        paddingLeft: `calc(${row.depth * 1.25}rem + 4px)`,
      }}
      title={onToggleFolder !== undefined ? title : undefined}
    >
      {isSelected ? (
        <span
          aria-hidden
          className="pointer-events-none absolute top-0.5 bottom-0.5 left-0 w-[2px] rounded-r-full"
          style={{ backgroundColor: theme.primary }}
        />
      ) : null}
      <span
        aria-hidden
        className="inline-block w-2.5 text-center"
        style={{ color: theme.textMuted, fontSize: "10px", lineHeight: 1 }}
      >
        {row.isCollapsed ? "▸" : "▾"}
      </span>
      <span
        className="chrome-code overflow-hidden text-ellipsis"
        style={{ color: theme.textMuted }}
      >
        {row.name}
      </span>
    </Button>
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
  const isUntracked = file.section === "untracked";
  const glyph = statusGlyph(file.status as GitFileStatus, isUntracked);
  const glyphColor = statusColor(file.status as GitFileStatus);
  const hasNumstat = file.added != null || file.removed != null;
  const { basename, prefix } = splitPath(file.path);
  const dir = stripTrailingSlash(prefix);
  const showDir = fileListMode === "flat" && dir !== "";
  const depthPad = fileListMode === "tree" ? `calc(${row.depth * 1.25}rem + 4px)` : "4px";
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
    e.preventDefault();
    if (isStaged) {
      onDoubleClickUnstage?.(file.path);
    } else {
      onDoubleClickStage?.(file.path);
    }
  };
  return (
    <div
      className="group relative flex items-center gap-1.5 whitespace-nowrap py-[2px] pr-1"
      onDoubleClick={handleDoubleClick}
      style={{
        backgroundColor: isSelected ? theme.backgroundElement : "transparent",
        paddingLeft: depthPad,
      }}
      onMouseEnter={(e) => {
        if (!isSelected && isToggleable) {
          e.currentTarget.style.backgroundColor = `color-mix(in oklab, ${theme.backgroundElement} 35%, transparent)`;
        }
      }}
      onMouseLeave={(e) => {
        if (!isSelected) {
          e.currentTarget.style.backgroundColor = "transparent";
        }
      }}
      title={doubleClickTitle}
    >
      {isSelected ? (
        <span
          aria-hidden
          className="pointer-events-none absolute top-0.5 bottom-0.5 left-0 w-[2px] rounded-r-full"
          style={{ backgroundColor: theme.primary }}
        />
      ) : null}
      <span
        aria-hidden
        className="inline-flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-[4px]"
        style={{
          backgroundColor: `color-mix(in oklab, ${glyphColor} 16%, transparent)`,
          color: glyphColor,
          fontFamily: "'JetBrainsMono Nerd Font Mono', monospace",
          fontSize: "9.5px",
          fontWeight: 600,
          lineHeight: 1,
        }}
      >
        {glyph}
      </span>
      <span className="chrome-code min-w-0 flex-1 overflow-hidden text-ellipsis">
        <span style={{ color: theme.text }}>{basename}</span>
        {showDir ? (
          <span style={{ color: theme.textMuted, opacity: 0.75 }}>
            {" "}
            {dir}
          </span>
        ) : null}
      </span>
      {diffCountEnabled ? (
        hasNumstat ? (
          <span className="chrome-code flex shrink-0 gap-1.5 tabular-nums">
            <span style={{ color: theme.diffAdded }}>{`+${padStart(file.added, addedW)}`}</span>
            <span style={{ color: theme.diffRemoved }}>{`−${padStart(file.removed, removedW)}`}</span>
          </span>
        ) : (
          <span
            className="chrome-code shrink-0"
            style={{ color: theme.textMuted, opacity: 0.6 }}
          >
            —
          </span>
        )
      ) : null}
    </div>
  );
}
