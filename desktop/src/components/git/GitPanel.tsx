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
      return "Staged Changes";
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
    return { label: "Working tree clean", labelColor: theme.textMuted };
  }
  return null;
}

export function GitPanel({ gitMode, gitPane, gitPanel, projectPath }: GitPanelProps): ReactNode {
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
  const { added: addedW, removed: removedW } = useMemo(() => maxDigitWidth(gitPanel.files), [
    gitPanel.files,
  ]);

  const hasProjectPath = projectPath != null && projectPath !== "";
  const placeholder = computeStatusPlaceholder(gitPanel, hasProjectPath);

  const hasRemoteTracking = gitPanel.ahead > 0 || gitPanel.behind > 0;
  // First non-empty section shows the `tree | flat` toggle (prefer `unstaged`).
  const toggleSection =
    tree.sections.find((s) => s.section === "unstaged" && s.files.length > 0)?.section ??
    tree.sections.find((s) => s.files.length > 0)?.section ??
    null;

  const selectedRowRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (selectedEntryKey == null || selectedEntryKey === "") {
      return;
    }
    selectedRowRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedEntryKey]);

  if (placeholder !== null) {
    return (
      <div className="flex h-full flex-col items-center pt-1 font-mono text-xs">
        <span style={{ color: placeholder.labelColor }}>{placeholder.label}</span>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-auto font-mono text-xs">
      {hasRemoteTracking ? (
        <div style={{ color: theme.textMuted }}>
          ↑{gitPanel.ahead} ↓{gitPanel.behind}
        </div>
      ) : null}
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
            style={{ marginTop: priorHasFiles ? "1em" : 0 }}
          >
            <SectionHeader
              count={sectionFiles.length}
              fileListMode={gitPane.fileListMode}
              showListModeToggle={sectionKey === toggleSection}
              title={sectionTitle(sectionKey)}
            />
            {sectionRows.map((row) => {
              const isSelected = row.key === selectedEntryKey;
              return (
                <Fragment key={row.key}>
                  <div ref={isSelected ? selectedRowRef : undefined}>
                    {row.kind === "folder" ? (
                      <FolderRow isSelected={isSelected} row={row} />
                    ) : (
                      <FileRow
                        addedW={addedW}
                        diffCountEnabled={gitPane.diffCount.enabled}
                        fileListMode={gitPane.fileListMode}
                        isSelected={isSelected}
                        removedW={removedW}
                        row={row}
                      />
                    )}
                  </div>
                </Fragment>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
