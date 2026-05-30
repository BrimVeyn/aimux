import { Fragment, type ReactNode, useEffect, useMemo, useRef } from "react";

import type { GitFileEntry, GitFileSection } from "@aimux/state/types";
import { buildGitTreeRows } from "@aimux/state/git-tree";

import { theme } from "@/lib/theme";
import type {
  GitFileEntryLite,
  GitModeLite,
  GitPaneLite,
  GitPanelLite,
} from "@/lib/types";

import { FileRow, FolderRow, SectionHeader } from "./GitPanelRow";

interface GitPanelProps {
  gitMode: GitModeLite;
  gitPane: GitPaneLite;
  gitPanel: GitPanelLite;
  onStageFile?: (path: string) => void;
  onToggleFolder?: (key: string) => void;
  onUnstageFile?: (path: string) => void;
  projectPath?: string;
}

// Stage 2a renders the three live sections only. `historical` (HEAD~N walk) and
// the `baseLabel` worktree fork-point review are out of scope until git mode key
// handling lands. Mirrors BASE_SECTION_ORDER in src/ui/components/git/git-panel.tsx.
const SECTION_ORDER: GitFileSection[] = ["staged", "unstaged", "untracked"];

function sectionTitle(section: GitFileSection): string {
  switch (section) {
    case "historical":
      return "History";
    case "staged":
      return "Staged";
    case "unstaged":
      return "Changes";
    case "untracked":
      return "Untracked";
  }
}

function maxDigitWidth(files: GitFileEntryLite[]): { added: number; removed: number } {
  let addedMax = 1;
  let removedMax = 1;
  for (const f of files) {
    if (f.added != null) {
      addedMax = Math.max(addedMax, String(f.added).length);
    }
    if (f.removed != null) {
      removedMax = Math.max(removedMax, String(f.removed).length);
    }
  }
  return { added: addedMax, removed: removedMax };
}

interface StatusPlaceholder {
  hint?: string;
  label: string;
  labelColor: string;
}

function computeStatusPlaceholder(
  gitPanel: GitPanelLite,
  hasProjectPath: boolean,
): StatusPlaceholder | null {
  if (!hasProjectPath) {
    return { label: "No active session", labelColor: theme.textMuted };
  }
  if (gitPanel.error === "not-a-repo") {
    return { label: "Not a git repository", labelColor: theme.textMuted };
  }
  if (gitPanel.error === "unknown") {
    return { label: "Git error", labelColor: theme.error };
  }
  if (gitPanel.files.length === 0) {
    return {
      hint: "Nothing to stage or commit.",
      label: "Working tree clean",
      labelColor: theme.text,
    };
  }
  return null;
}

// Panel-level header strip: remote tracking (left) + current list view mode
// (right). The view mode is rendered as a quiet status indicator, not a button
// — it reflects the keyboard-driven mode rather than offering a mouse toggle.
function PanelTopBar({
  ahead,
  behind,
  fileListMode,
}: {
  ahead: number;
  behind: number;
  fileListMode: "flat" | "tree";
}): ReactNode {
  const hasRemote = ahead > 0 || behind > 0;
  return (
    <div className="flex items-center justify-between gap-2 px-1 pt-1 pb-1.5">
      <div className="flex items-center gap-1">
        {hasRemote ? (
          <>
            {ahead > 0 ? (
              <span
                className="chrome-code inline-flex items-center gap-0.5 rounded-full px-1.5 py-px"
                style={{
                  backgroundColor: `color-mix(in oklab, ${theme.success} 12%, transparent)`,
                  color: theme.success,
                }}
                title={`${ahead} commit${ahead === 1 ? "" : "s"} ahead of remote`}
              >
                <span aria-hidden>↑</span>
                <span className="tabular-nums">{ahead}</span>
              </span>
            ) : null}
            {behind > 0 ? (
              <span
                className="chrome-code inline-flex items-center gap-0.5 rounded-full px-1.5 py-px"
                style={{
                  backgroundColor: `color-mix(in oklab, ${theme.warning} 14%, transparent)`,
                  color: theme.warning,
                }}
                title={`${behind} commit${behind === 1 ? "" : "s"} behind remote`}
              >
                <span aria-hidden>↓</span>
                <span className="tabular-nums">{behind}</span>
              </span>
            ) : null}
          </>
        ) : null}
      </div>
      <ViewModeIndicator mode={fileListMode} />
    </div>
  );
}

function ViewModeIndicator({ mode }: { mode: "flat" | "tree" }): ReactNode {
  return (
    <span
      className="chrome-meta inline-flex items-center gap-1"
      style={{ color: theme.textMuted, opacity: 0.7 }}
      title={mode === "tree" ? "Tree view" : "Flat view"}
    >
      {mode === "tree" ? <TreeIcon /> : <FlatIcon />}
      <span style={{ fontSize: "10px" }}>{mode}</span>
    </span>
  );
}

function TreeIcon(): ReactNode {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M2 1.5 V8.5" />
      <path d="M2 4 H6" />
      <path d="M2 7 H6" />
    </svg>
  );
}

function FlatIcon(): ReactNode {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M1.5 2.5 H8.5" />
      <path d="M1.5 5 H8.5" />
      <path d="M1.5 7.5 H8.5" />
    </svg>
  );
}

function Placeholder({ placeholder }: { placeholder: StatusPlaceholder }): ReactNode {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 px-4 text-center">
      <span className="chrome-label" style={{ color: placeholder.labelColor }}>
        {placeholder.label}
      </span>
      {placeholder.hint !== undefined ? (
        <span
          className="chrome-meta"
          style={{ color: theme.textMuted, opacity: 0.75 }}
        >
          {placeholder.hint}
        </span>
      ) : null}
    </div>
  );
}

export function GitPanel({
  gitMode,
  gitPane,
  gitPanel,
  onStageFile,
  onToggleFolder,
  onUnstageFile,
  projectPath,
}: GitPanelProps): ReactNode {
  const selectedEntryKey = gitMode.selectedEntryKey;
  // GitFileEntryLite is the wire-side projection of GitFileEntry; the optional
  // fields differ (e.g. `added: number | null` vs `added?: number`) but
  // buildGitTreeRows only reads `path`/`section`/`repoPath`. Cast to the TUI
  // type so we can reuse the function as-is.
  const files = gitPanel.files as unknown as GitFileEntry[];
  const tree = useMemo(
    () =>
      buildGitTreeRows(
        files,
        gitMode.collapsedFolders,
        gitPane.fileListMode,
        gitPane.treeCompaction,
      ),
    [files, gitMode.collapsedFolders, gitPane.fileListMode, gitPane.treeCompaction],
  );
  const { added: addedW, removed: removedW } = useMemo(
    () => maxDigitWidth(gitPanel.files),
    [gitPanel.files],
  );

  const hasProjectPath = projectPath != null && projectPath !== "";
  const placeholder = computeStatusPlaceholder(gitPanel, hasProjectPath);

  const selectedRowRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (selectedEntryKey == null || selectedEntryKey === "") {
      return;
    }
    selectedRowRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedEntryKey]);

  if (placeholder !== null) {
    return <Placeholder placeholder={placeholder} />;
  }

  return (
    <div className="flex h-full flex-col overflow-auto">
      <PanelTopBar
        ahead={gitPanel.ahead}
        behind={gitPanel.behind}
        fileListMode={gitPane.fileListMode}
      />
      {SECTION_ORDER.map((sectionKey, idx) => {
        const section = tree.sections.find((s) => s.section === sectionKey);
        const sectionFiles = section?.files ?? [];
        const sectionRows = section?.rows ?? [];
        if (sectionFiles.length === 0) {
          return null;
        }
        const priorHasFiles = SECTION_ORDER.slice(0, idx).some(
          (k) => (tree.sections.find((e) => e.section === k)?.files.length ?? 0) > 0,
        );
        return (
          <div
            key={sectionKey}
            className="flex flex-col"
            style={{ marginTop: priorHasFiles ? 12 : 0 }}
          >
            <SectionHeader
              count={sectionFiles.length}
              title={sectionTitle(sectionKey)}
            />
            <div className="flex flex-col">
              {sectionRows.map((row) => {
                const isSelected = row.key === selectedEntryKey;
                return (
                  <Fragment key={row.key}>
                    <div ref={isSelected ? selectedRowRef : undefined}>
                      {row.kind === "folder" ? (
                        <FolderRow
                          isSelected={isSelected}
                          onToggleFolder={onToggleFolder}
                          row={row}
                        />
                      ) : (
                        <FileRow
                          addedW={addedW}
                          diffCountEnabled={gitPane.diffCount.enabled}
                          fileListMode={gitPane.fileListMode}
                          isSelected={isSelected}
                          onDoubleClickStage={onStageFile}
                          onDoubleClickUnstage={onUnstageFile}
                          removedW={removedW}
                          row={row}
                        />
                      )}
                    </div>
                  </Fragment>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
