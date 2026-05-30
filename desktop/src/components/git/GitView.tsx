import type { ReactNode } from "react";

import type { GitFileEntry } from "@aimux/state/types";
import { getSelectedGitFile, gitFileKey } from "@aimux/state/git-tree";

import { theme } from "@/lib/theme";
import type { GitModeLite, GitPaneLite, GitPanelLite } from "@/lib/types";

import { DiffStage } from "./DiffStage";
import { GitPanel } from "./GitPanel";

interface GitViewProps {
  gitMode: GitModeLite;
  gitPane: GitPaneLite;
  gitPanel: GitPanelLite;
  onExit?: () => void;
  onStageFile?: (path: string) => void;
  onUnstageFile?: (path: string) => void;
  projectPath?: string;
  themeId: string;
}

export function GitView({
  gitMode,
  gitPane,
  gitPanel,
  onExit,
  onStageFile,
  onUnstageFile,
  projectPath,
  themeId,
}: GitViewProps): ReactNode {
  // GitFileEntryLite is the wire-side projection of GitFileEntry; only the
  // fields read by getSelectedGitFile (path/section/repoPath) are required.
  const files = gitPanel.files as unknown as GitFileEntry[];
  const selectedFile = getSelectedGitFile(files, {
    collapsedFolders: gitMode.collapsedFolders,
    compact: gitPane.treeCompaction,
    fileListMode: gitPane.fileListMode,
    selectedEntryKey: gitMode.selectedEntryKey,
  });
  const selectedKey = selectedFile ? gitFileKey(selectedFile) : null;
  const diff = selectedKey !== null ? gitMode.diffs[selectedKey] : undefined;
  const loading = selectedKey !== null ? gitMode.loading[selectedKey] === true : false;
  const parsedFile = selectedKey !== null ? gitMode.parsedFiles[selectedKey]?.file : null;

  const pendingPath = gitMode.pendingDeletePath;
  const pendingIsUntracked =
    pendingPath !== null &&
    selectedFile?.path === pendingPath &&
    selectedFile.section === "untracked";
  let pendingHint: string | null = null;
  if (pendingPath !== null && selectedFile !== null) {
    pendingHint = pendingIsUntracked
      ? "press d again to delete file"
      : "press d again to discard changes";
  }
  const actionMessage = gitMode.actionMessage;
  const hasFooter =
    (pendingHint !== null && pendingHint !== "") ||
    (actionMessage !== null && actionMessage !== "");

  const panelBasis = `${Math.max(15, Math.min(60, gitPane.diffModeRatio * 100))}%`;

  return (
    <div
      className="flex h-full w-full flex-col overflow-hidden"
      style={{ backgroundColor: theme.background }}
    >
      <div className="flex min-h-0 flex-1 flex-row">
        <div
          className="flex flex-shrink-0 flex-col overflow-hidden border-r"
          style={{
            backgroundColor: theme.backgroundPanel,
            borderColor: theme.border,
            flexBasis: panelBasis,
          }}
        >
          <div className="flex flex-shrink-0 flex-col gap-0.5 px-2 pt-2 pb-1 font-mono text-xs">
            <div style={{ color: theme.text, fontWeight: "bold" }}>aimux · git</div>
            {gitPanel.branch !== null && gitPanel.branch !== "" ? (
              <div style={{ color: theme.text }}>{gitPanel.branch}</div>
            ) : null}
            {gitMode.headOffset > 0 ? (
              <div className="flex gap-2">
                <span style={{ color: theme.warning, fontWeight: "bold" }}>
                  HEAD~{gitMode.headOffset}
                </span>
                <span style={{ color: theme.textMuted }}>[ newer · ] older</span>
              </div>
            ) : null}
            {gitMode.reviewBase ? (
              <div className="flex gap-2">
                <span style={{ color: theme.primary, fontWeight: "bold" }}>review</span>
                <span style={{ color: theme.textMuted }}>b: back</span>
              </div>
            ) : null}
          </div>
          <div className="min-h-0 flex-1 overflow-hidden px-2 pb-2">
            <GitPanel
              gitMode={gitMode}
              gitPane={gitPane}
              gitPanel={gitPanel}
              onStageFile={onStageFile}
              onUnstageFile={onUnstageFile}
              projectPath={projectPath}
            />
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div
            className="flex flex-shrink-0 flex-row items-center gap-2 px-3 py-1 font-mono text-xs"
            style={{ backgroundColor: theme.backgroundPanel }}
          >
            <div
              className="min-w-0 flex-1 truncate"
              style={{ color: selectedFile !== null ? theme.text : theme.textMuted }}
            >
              {selectedFile !== null ? selectedFile.path : "Diff"}
            </div>
            <div
              className="flex flex-shrink-0 gap-1 text-[0.7rem]"
              style={{ color: theme.textMuted }}
            >
              <span>view: {gitMode.diffView}</span>
              <span>·</span>
              <span>v to toggle</span>
            </div>
            {onExit !== undefined ? (
              <button
                className="cursor-pointer rounded px-2 py-0.5"
                onClick={onExit}
                style={{ backgroundColor: theme.backgroundElement, color: theme.text }}
                type="button"
              >
                Exit diff
              </button>
            ) : null}
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <DiffStage
              diff={diff}
              diffView={gitMode.diffView}
              loading={loading}
              parsedFile={parsedFile}
              selectedKey={selectedKey}
              themeId={themeId}
            />
          </div>
        </div>
      </div>
      {hasFooter ? (
        <div
          className="flex-shrink-0 px-3 py-1 font-mono text-xs"
          style={{ backgroundColor: theme.backgroundPanel }}
        >
          {pendingHint !== null && pendingHint !== "" ? (
            <span style={{ color: theme.warning, fontWeight: "bold" }}>{pendingHint}</span>
          ) : actionMessage !== null && actionMessage !== "" ? (
            <span style={{ color: theme.primary }}>
              {actionMessage.split("\n").map((line, idx) => (
                // Message lines are positional; index is the identity.
                // eslint-disable-next-line react/no-array-index-key
                <span key={idx} className="block">
                  {line}
                </span>
              ))}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
