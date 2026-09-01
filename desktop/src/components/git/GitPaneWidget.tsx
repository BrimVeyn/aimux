import { useState } from "react";

import type {
  GitHubProjection,
  GitModeLite,
  GitPaneLite,
  GitPanelLite,
} from "@aimux/gui-protocol";

import { Button } from "@/components/ui/button";
import { theme } from "@/lib/theme";

import { GitPanel } from "./GitPanel";
import { PrChecksPanel } from "./PrChecksPanel";
import { PrStateRow } from "./PrStateRow";

type GitPaneTab = "diff" | "github";

/** Nerd-font git branch glyph. */
const BRANCH_GLYPH = "\u{e702}";

interface GitPaneWidgetProps {
  github: GitHubProjection;
  gitMode: GitModeLite;
  gitPane: GitPaneLite;
  gitPanel: GitPanelLite;
  projectPath: string | undefined;
  /** The bar's content width in cells — the checks panel drops a column below 34. */
  contentWidth: number;
  onOpenUrl: (url: string) => void;
  onPrAction: () => void;
  onStageFile: (path: string) => void;
  onSwitchAccount: () => void;
  onToggleFileListMode: () => void;
  onToggleFolder: (key: string) => void;
  onUnstageFile: (path: string) => void;
}

/**
 * Transcription of `pane/git-pane-widget.tsx` + `pane/git-pane-header.tsx`: the
 * tab row, the PR state row or the branch row under it, and then either the
 * file list or the PR checks.
 */
export function GitPaneWidget({
  contentWidth,
  github,
  gitMode,
  gitPane,
  gitPanel,
  onOpenUrl,
  onPrAction,
  onStageFile,
  onSwitchAccount,
  onToggleFileListMode,
  onToggleFolder,
  onUnstageFile,
  projectPath,
}: GitPaneWidgetProps) {
  const [tab, setTab] = useState<GitPaneTab>("diff");

  const hasProject = projectPath != null && projectPath !== "";
  if (!hasProject) return null;

  const status = github.status;
  // The row only occupies its band once we know there is a PR — an unknown or
  // resolved-to-nothing state gives the row back.
  const prRow = status?.kind === "ok" ? status : null;
  // The PR row already carries the branch identity, so the branch row is only
  // worth a line without a PR.
  const showBranchRow = prRow === null && gitPanel.error === null;
  const showTracking =
    tab !== "github" && (gitPanel.ahead > 0 || gitPanel.behind > 0);
  const showToggle = tab !== "github" && gitPanel.files.length > 0;
  const branch = gitPanel.branch;
  const branchIsResolved = branch != null && branch !== "";

  return (
    <div className="tui flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-col pb-[--tui-row]">
        {prRow !== null ? (
          <PrStateRow
            onAct={onPrAction}
            onOpen={onOpenUrl}
            pr={prRow.pr}
            row={prRow.row}
          />
        ) : null}

        <div className="tui-row justify-between">
          <span className="flex">
            <Tab active={tab === "diff"} label="diff" onClick={() => setTab("diff")} />
            <Tab
              active={tab === "github"}
              label="github"
              onClick={() => setTab("github")}
            />
          </span>
          <span className="flex items-center">
            {showTracking ? (
              <span className="pr-[2ch]" style={{ color: theme.textMuted }}>
                {gitPanel.ahead > 0 ? `↑${gitPanel.ahead}` : ""}
                {gitPanel.ahead > 0 && gitPanel.behind > 0 ? " " : ""}
                {gitPanel.behind > 0 ? `↓${gitPanel.behind}` : ""}
              </span>
            ) : null}
            {showToggle ? (
              <Button
                variant="ghost"
                size="tui"
                aria-label="Toggle file list mode"
                onClick={onToggleFileListMode}
              >
                <span
                  style={{
                    color:
                      gitPane.fileListMode === "tree"
                        ? theme.primary
                        : theme.textMuted,
                  }}
                >
                  tree
                </span>
                <span style={{ color: theme.textMuted }}> | </span>
                <span
                  style={{
                    color:
                      gitPane.fileListMode === "flat"
                        ? theme.primary
                        : theme.textMuted,
                  }}
                >
                  flat
                </span>
              </Button>
            ) : null}
          </span>
        </div>

        {showBranchRow ? (
          <div className="tui-row px-[1ch]">
            <span style={{ color: theme.textMuted }}>{BRANCH_GLYPH} </span>
            <span
              className="truncate"
              style={{
                color: branchIsResolved ? theme.text : theme.textMuted,
                fontWeight: branchIsResolved ? 700 : 400,
              }}
            >
              {branchIsResolved ? branch : "detached"}
            </span>
          </div>
        ) : null}
      </div>

      {tab === "github" ? (
        <PrChecksPanel
          contentWidth={contentWidth}
          github={github}
          onOpenUrl={onOpenUrl}
          onSwitchAccount={onSwitchAccount}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <GitPanel
            gitMode={gitMode}
            gitPane={gitPane}
            gitPanel={gitPanel}
            onStageFile={onStageFile}
            onToggleFolder={onToggleFolder}
            onUnstageFile={onUnstageFile}
            projectPath={projectPath}
          />
        </div>
      )}
    </div>
  );
}

function Tab({
  active,
  label,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="tui"
      aria-current={active ? "true" : undefined}
      onClick={onClick}
      style={{
        backgroundColor: active ? theme.backgroundElement : undefined,
        color: active ? theme.text : theme.textMuted,
      }}
    >
      {label}
    </Button>
  );
}
