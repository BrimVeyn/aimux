import { useCallback, useMemo, useState } from "react";

import type {
  ProjectedTab,
  ProjectRecordLite,
  WorkspaceActivity,
  WorkspaceLite,
} from "@aimux/gui-protocol";

import { formatDiffStat, getSidebarWorkspaces } from "@aimux/state/workspace-view";

import { Button } from "@/components/ui/button";
import { theme } from "@/lib/theme";

import { Spinner } from "./Spinner";

/** Same pair the git panel folds its directories with, so the gesture reads once. */
const COLLAPSED_GLYPH = "▸";
const EXPANDED_GLYPH = "▾";
/** Nerd-font git branch glyph, the one the TUI hangs under a workspace name. */
const BRANCH_GLYPH = "\u{e702}";

type Divergence = {
  ahead: number;
  behind: number;
  added?: number;
  removed?: number;
};

interface SidebarProps {
  /** In display order, as the host sends it. */
  projects: ProjectRecordLite[];
  currentProjectId: string | null;
  workspaceActivity: Record<string, WorkspaceActivity>;
  workspaceDivergence: Record<string, Divergence>;
  tabs: ProjectedTab[];
  onSelectWorkspace: (projectId: string, workspaceId: string) => void;
  onActivateProject: (projectId: string) => void;
  onToggleCollapsed: (projectId: string) => void;
  onNewWorkspace: (projectId: string) => void;
  onNewProject: () => void;
  onReorderProjects: (orderedIds: string[]) => void;
  // Fires before any button inside the sidebar. The shell wires this to
  // leaveInsertMode so any sidebar interaction drops out of terminal-input,
  // including clicks on whitespace / labels that aren't buttons themselves.
  onInteract?: () => void;
}

/**
 * Transcription of `project-list.tsx`: a rule, a header, then one flat list of
 * project headings each followed by its workspaces. Deliberately no tabs — the
 * strip above the panes owns those, and a row that listed them too would make
 * the sidebar mean two things.
 *
 * Every target is a real `<Button>`, laid out as siblings rather than nested:
 * a row's own action and the small ones on it are separate buttons in one flex
 * line, so each gets the full row height to be clicked in. A glyph wrapped in a
 * span was two cells tall and impossible to hit.
 */
export function Sidebar({
  currentProjectId,
  onInteract,
  onNewProject,
  onNewWorkspace,
  onReorderProjects,
  onSelectWorkspace,
  onActivateProject,
  onToggleCollapsed,
  projects,
  tabs,
  workspaceActivity,
  workspaceDivergence,
}: SidebarProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  // Where the drop would land, as a gap index (0 = above the first project,
  // projects.length = below the last). The list itself never moves while
  // dragging — only this bar does, so rows can't slide out from under the
  // pointer and make the drag oscillate.
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const order = useMemo(() => projects.map((p) => p.id), [projects]);

  const commitDrop = useCallback(() => {
    const source = draggingId;
    const slot = dropIndex;
    setDraggingId(null);
    setDropIndex(null);
    if (source === null || slot === null) return;
    const from = order.indexOf(source);
    if (from < 0) return;
    const next = order.filter((id) => id !== source);
    next.splice(slot > from ? slot - 1 : slot, 0, source);
    if (next.every((id, i) => id === order[i])) return;
    onReorderProjects(next);
  }, [draggingId, dropIndex, onReorderProjects, order]);

  const workspacesWithSleepingTabs = useMemo(() => {
    const ids = new Set<string>();
    for (const tab of tabs) {
      if (tab.hibernated === true && tab.workspaceId !== undefined) {
        ids.add(tab.workspaceId);
      }
    }
    return ids;
  }, [tabs]);

  return (
    <div
      className="tui flex h-full flex-col overflow-hidden"
      style={{ backgroundColor: theme.background }}
      onMouseDownCapture={onInteract}
      onDragEnd={commitDrop}
    >
      <div
        className="tui-row overflow-hidden"
        style={{ color: theme.border }}
        aria-hidden
      >
        {"─".repeat(400)}
      </div>

      <div className="tui-row pl-[1ch]">
        <span style={{ color: theme.text }}>Projects</span>
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="tui"
          aria-label="New project"
          title="New project"
          onClick={onNewProject}
          style={{ color: theme.textMuted }}
        >
          +
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {projects.map((project, index) => {
          const isCurrent = project.id === currentProjectId;
          return (
            <div key={project.id}>
              <DropGap
                active={dropIndex === index}
                index={index}
                onEnter={setDropIndex}
              />
              <ProjectRow
                current={isCurrent}
                dragging={draggingId === project.id}
                onDragStart={setDraggingId}
                onNewWorkspace={onNewWorkspace}
                onActivateProject={onActivateProject}
                onToggleCollapsed={onToggleCollapsed}
                project={project}
              />
              {getSidebarWorkspaces(project, isCurrent).map((workspace) => (
                <WorkspaceRow
                  key={workspace.id}
                  activity={workspaceActivity[workspace.id]}
                  divergence={workspaceDivergence[workspace.id]}
                  hasSleepingTabs={workspacesWithSleepingTabs.has(workspace.id)}
                  inCurrentGroup={isCurrent}
                  isActiveItem={
                    isCurrent && workspace.id === project.activeWorkspaceId
                  }
                  onSelect={() => onSelectWorkspace(project.id, workspace.id)}
                  workspace={workspace}
                />
              ))}
            </div>
          );
        })}
        {/* Trailing slot, so "after the last project" is reachable. */}
        <DropGap
          active={dropIndex === projects.length}
          index={projects.length}
          onEnter={setDropIndex}
        />
      </div>
    </div>
  );
}

/** The one-row gap above a project — blank, or the drop preview mid-drag. */
function DropGap({
  active,
  index,
  onEnter,
}: {
  index: number;
  active: boolean;
  onEnter: (index: number) => void;
}) {
  return (
    <div
      className="tui-row overflow-hidden"
      onDragEnter={() => onEnter(index)}
      onDragOver={(e) => e.preventDefault()}
      style={{ color: theme.primary }}
    >
      {/* Heavier than the chrome rules, so the drop preview never reads as a
          border. */}
      {active ? "━".repeat(400) : ""}
    </div>
  );
}

function ProjectRow({
  current,
  dragging,
  onDragStart,
  onNewWorkspace,
  onActivateProject,
  onToggleCollapsed,
  project,
}: {
  project: ProjectRecordLite;
  current: boolean;
  dragging: boolean;
  onDragStart: (id: string) => void;
  onActivateProject: (projectId: string) => void;
  onToggleCollapsed: (projectId: string) => void;
  onNewWorkspace: (projectId: string) => void;
}) {
  // Only the drag highlight is "selected"-strength here. A heading that lights
  // up like a cursor row is what made the project look like a workspace.
  let background: string | undefined;
  if (dragging) background = theme.backgroundElement;
  else if (current) background = theme.backgroundPanel;

  const collapsed = project.collapsed === true;

  return (
    <div
      className="tui-row"
      draggable
      onDragStart={() => onDragStart(project.id)}
      style={{ backgroundColor: background }}
    >
      <Button
        variant="ghost"
        size="tui"
        aria-expanded={!collapsed}
        aria-label={collapsed ? "Expand project" : "Collapse project"}
        onClick={() => onToggleCollapsed(project.id)}
        style={{ color: theme.textMuted }}
      >
        {collapsed ? COLLAPSED_GLYPH : EXPANDED_GLYPH}
      </Button>
      {/* The heading stands for the project itself, not for whichever workspace
          was last active in it, so clicking it lands on the checkout. */}
      <Button
        variant="ghost"
        size="tui"
        className="min-w-0 flex-1 justify-start pl-0"
        onClick={() => onActivateProject(project.id)}
        style={{ color: theme.text }}
      >
        <span className="truncate">{project.name}</span>
      </Button>
      <Button
        variant="ghost"
        size="tui"
        aria-label="New workspace"
        title="New workspace"
        onClick={() => onNewWorkspace(project.id)}
        style={{ color: theme.textMuted }}
      >
        +
      </Button>
    </div>
  );
}

function WorkspaceRow({
  activity,
  divergence,
  hasSleepingTabs,
  inCurrentGroup,
  isActiveItem,
  onSelect,
  workspace,
}: {
  workspace: WorkspaceLite;
  isActiveItem: boolean;
  inCurrentGroup: boolean;
  activity: WorkspaceActivity | undefined;
  divergence: Divergence | undefined;
  hasSleepingTabs: boolean;
  onSelect: () => void;
}) {
  let background: string | undefined;
  if (isActiveItem) background = theme.backgroundElement;
  else if (inCurrentGroup) background = theme.backgroundPanel;

  const hasBranch = workspace.branch != null && workspace.branch !== "";
  const { added, removed } = formatDiffStat(divergence);
  const marker = statusMarker(activity, hasSleepingTabs);

  return (
    // One button for the whole row, both lines of it — the branch line belongs
    // to the same target as the name above it.
    <Button
      variant="ghost"
      size="tui"
      aria-current={isActiveItem ? "true" : undefined}
      onClick={onSelect}
      className="relative h-auto w-full flex-col items-stretch gap-0 py-0 pr-[1ch] pl-0"
      style={{ backgroundColor: background }}
    >
      {/* The cursor: ONE bar down the left of the row, spanning both lines. Set
          as a `▌` per line it broke in two — the glyph is shorter than the row,
          so the leading between the lines showed through it. */}
      {isActiveItem ? (
        <span
          aria-hidden
          className="absolute top-0 bottom-0 left-0 w-[1ch]"
          style={{ backgroundColor: theme.primary }}
        />
      ) : null}
      <span className="tui-row w-full pl-[1ch]">
        <span style={{ color: marker.color }}>{marker.glyph}</span>
        {/* Full strength only under the cursor. Every name at full strength
            reads as a wall of white; every name muted leaves the selected row
            with nothing but a shade of grey to say so. */}
        <span
          className="truncate"
          style={{
            color: isActiveItem ? theme.text : theme.textMuted,
            fontWeight: isActiveItem ? 700 : 400,
          }}
        >
          {workspace.name}
        </span>
        <span className="flex-1" />
        {added !== "" ? (
          <span style={{ color: theme.success }}>{added}</span>
        ) : null}
        {added !== "" && removed !== "" ? <span> </span> : null}
        {removed !== "" ? (
          <span style={{ color: theme.error }}>{removed}</span>
        ) : null}
      </span>
      {/* Second line, hanging under the name, and where the branch glyph lives
          — it labels the branch, not the workspace. Only workspaces that own a
          branch get one. */}
      {hasBranch ? (
        <span className="tui-row w-full pl-[1ch]">
          <span>{"  "}</span>
          <span className="truncate" style={{ color: theme.textMuted }}>
            {BRANCH_GLYPH} {workspace.branch}
          </span>
        </span>
      ) : null}
    </Button>
  );
}

/**
 * Two cells, always: the glyph and the gap after it, so nothing shifts when an
 * agent starts or stops. A question outranks work in progress, which outranks
 * "it finished and you haven't looked"; hibernation comes last, because
 * anything else is news and that is the absence of it.
 */
function statusMarker(
  activity: WorkspaceActivity | undefined,
  hasSleepingTabs: boolean,
): { glyph: React.ReactNode; color: string } {
  if (activity?.waiting === true) return { color: theme.warning, glyph: "? " };
  if (activity?.working === true) {
    return {
      color: theme.primary,
      glyph: (
        <span className="inline-flex w-[2ch]">
          <Spinner color={theme.primary} />
        </span>
      ),
    };
  }
  if (activity?.done === true) return { color: theme.success, glyph: "● " };
  if (hasSleepingTabs) return { color: theme.textMuted, glyph: "z " };
  return { color: theme.textMuted, glyph: "  " };
}
