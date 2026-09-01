import type {
  ProjectedTab,
  ProjectRecordLite,
  ProjectStatus,
  WorkspaceActivity,
  WorkspaceLite,
} from "@aimux/gui-protocol";

import { theme } from "@/lib/theme";

import { Spinner } from "./Spinner";

interface SidebarProps {
  projects: ProjectRecordLite[];
  currentProjectId: string | null;
  projectStatuses: Record<string, ProjectStatus>;
  workspaceActivity: Record<string, WorkspaceActivity>;
  workspaceDivergence: Record<
    string,
    { ahead: number; behind: number; added?: number; removed?: number }
  >;
  tabs: ProjectedTab[];
  activeTabId: string | null;
  onSelectTab: (id: string) => void;
  onSelectWorkspace: (projectId: string, workspaceId: string) => void;
  onSwitchProject: (projectId: string) => void;
  onDeleteProject: (projectId: string) => void;
  onNewProject: () => void;
  onNewTab: () => void;
  // Fires before any button inside the sidebar. The shell wires this to
  // leaveInsertMode so any sidebar interaction drops out of terminal-input,
  // including clicks on whitespace / labels that aren't buttons themselves.
  onInteract?: () => void;
}

/**
 * The projects widget: projects → workspaces → tabs, the same three levels the
 * TUI's `project-list` / `workspace-row` / `tab-item` draw. Only the current
 * project expands — the others are one row you click to switch to.
 */
export function Sidebar({
  activeTabId,
  currentProjectId,
  onDeleteProject,
  onInteract,
  onNewProject,
  onNewTab,
  onSelectTab,
  onSelectWorkspace,
  onSwitchProject,
  projects,
  projectStatuses,
  tabs,
  workspaceActivity,
  workspaceDivergence,
}: SidebarProps) {
  return (
    <div
      className="relative z-[60] flex h-full flex-col overflow-hidden"
      style={{ backgroundColor: theme.background }}
      onMouseDownCapture={onInteract}
    >
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <span className="chrome-meta" style={{ color: theme.textMuted }}>
          Projects
        </span>
        <IconButton label="New project" onClick={onNewProject} />
      </div>

      <div className="flex-1 overflow-y-auto pb-2">
        {projects.map((project) => (
          <ProjectRow
            key={project.id}
            activeTabId={activeTabId}
            current={project.id === currentProjectId}
            onDelete={onDeleteProject}
            onNewTab={onNewTab}
            onSelectTab={onSelectTab}
            onSelectWorkspace={onSelectWorkspace}
            onSwitchProject={onSwitchProject}
            project={project}
            status={projectStatuses[project.id]}
            tabs={tabs}
            workspaceActivity={workspaceActivity}
            workspaceDivergence={workspaceDivergence}
          />
        ))}
      </div>
    </div>
  );
}

function ProjectRow({
  activeTabId,
  current,
  onDelete,
  onNewTab,
  onSelectTab,
  onSelectWorkspace,
  onSwitchProject,
  project,
  status,
  tabs,
  workspaceActivity,
  workspaceDivergence,
}: {
  project: ProjectRecordLite;
  current: boolean;
  status: ProjectStatus | undefined;
  tabs: ProjectedTab[];
  activeTabId: string | null;
  workspaceActivity: Record<string, WorkspaceActivity>;
  workspaceDivergence: Record<
    string,
    { ahead: number; behind: number; added?: number; removed?: number }
  >;
  onSelectTab: (id: string) => void;
  onSelectWorkspace: (projectId: string, workspaceId: string) => void;
  onSwitchProject: (projectId: string) => void;
  onDelete: (projectId: string) => void;
  onNewTab: () => void;
}) {
  const workspaces = project.workspaces ?? [];
  return (
    <div className="mb-1">
      <div
        onMouseDown={() => {
          if (!current) onSwitchProject(project.id);
        }}
        className="group flex cursor-pointer items-center gap-2 px-4 py-1.5 transition-[background-color] duration-150 ease-out"
        style={{
          backgroundColor: current ? theme.backgroundElement : "transparent",
        }}
      >
        <StatusDot status={status} />
        <span
          className="chrome-title truncate"
          style={{ color: current ? theme.text : theme.textMuted }}
        >
          {project.name}
        </span>
        <button
          type="button"
          aria-label="Close project"
          onMouseDown={(e) => {
            e.stopPropagation();
            onDelete(project.id);
          }}
          className="ml-auto flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full opacity-0 transition-opacity duration-150 group-hover:opacity-100"
          style={{ color: theme.textMuted }}
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

      {current
        ? workspaces.map((workspace) => (
            <WorkspaceRow
              key={workspace.id}
              activeTabId={activeTabId}
              activity={workspaceActivity[workspace.id]}
              active={workspace.id === project.activeWorkspaceId}
              divergence={workspaceDivergence[workspace.id]}
              onNewTab={onNewTab}
              onSelect={() => onSelectWorkspace(project.id, workspace.id)}
              onSelectTab={onSelectTab}
              tabs={tabs.filter((tab) => tab.workspaceId === workspace.id)}
              workspace={workspace}
            />
          ))
        : null}
    </div>
  );
}

function WorkspaceRow({
  active,
  activeTabId,
  activity,
  divergence,
  onNewTab,
  onSelect,
  onSelectTab,
  tabs,
  workspace,
}: {
  workspace: WorkspaceLite;
  active: boolean;
  activity: WorkspaceActivity | undefined;
  divergence: { ahead: number; behind: number } | undefined;
  tabs: ProjectedTab[];
  activeTabId: string | null;
  onSelect: () => void;
  onSelectTab: (id: string) => void;
  onNewTab: () => void;
}) {
  return (
    <div>
      <div
        onMouseDown={onSelect}
        className="group flex cursor-pointer items-center gap-1.5 py-1 pr-3 pl-6"
        style={{
          backgroundColor: active
            ? `color-mix(in oklab, ${theme.primary} 12%, transparent)`
            : "transparent",
        }}
      >
        <ActivityGlyph activity={activity} />
        <span
          className="chrome-label flex-1 truncate"
          style={{ color: active ? theme.text : theme.textMuted }}
        >
          {workspace.name}
        </span>
        <Divergence divergence={divergence} />
        {active ? <IconButton label="New tab" onClick={onNewTab} /> : null}
      </div>

      {active
        ? tabs.map((tab) => (
            <div
              key={tab.id}
              onMouseDown={() => onSelectTab(tab.id)}
              className="cursor-pointer py-0.5 pr-3 pl-10"
            >
              <span
                className="chrome-label truncate"
                style={{
                  color: tab.id === activeTabId ? theme.text : theme.textMuted,
                }}
              >
                {tab.title}
              </span>
            </div>
          ))
        : null}
    </div>
  );
}

/** Ahead/behind the ref this workspace forked from. Nothing when in sync. */
function Divergence({
  divergence,
}: {
  divergence: { ahead: number; behind: number } | undefined;
}) {
  if (divergence === undefined) return null;
  const { ahead, behind } = divergence;
  if (ahead === 0 && behind === 0) return null;
  return (
    <span className="chrome-code shrink-0" style={{ color: theme.textMuted }}>
      {ahead > 0 ? `↑${ahead}` : ""}
      {behind > 0 ? `↓${behind}` : ""}
    </span>
  );
}

function ActivityGlyph({ activity }: { activity: WorkspaceActivity | undefined }) {
  if (activity?.working === true) {
    return (
      <span className="inline-flex h-2 w-2 items-center justify-center">
        <Spinner color={theme.primary} />
      </span>
    );
  }
  const color =
    activity?.waiting === true
      ? theme.warning
      : activity?.done === true
        ? theme.success
        : null;
  if (color === null) {
    // Keeps the labels aligned with the rows that do carry a glyph.
    return <span className="inline-block h-1.5 w-1.5 shrink-0" />;
  }
  return (
    <span
      aria-hidden
      className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
      style={{ backgroundColor: color }}
    />
  );
}

function StatusDot({ status }: { status: ProjectStatus | undefined }) {
  if (status?.working === true) {
    return (
      <span className="inline-flex h-2 w-2 items-center justify-center">
        <Spinner color={theme.primary} />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
      style={{
        backgroundColor:
          status?.waiting === true ? theme.warning : theme.textMuted,
      }}
    />
  );
}

function IconButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onMouseDown={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md transition-[background-color,color] duration-150 ease-out"
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
    </button>
  );
}
