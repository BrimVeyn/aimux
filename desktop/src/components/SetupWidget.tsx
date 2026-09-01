import type { GuiIntent, SetupProjection } from "@aimux/gui-protocol";

import { Button } from "@/components/ui/button";
import { theme } from "@/lib/theme";

type SetupAction = Extract<GuiIntent, { kind: "setup.action" }>["action"];

/**
 * Transcription of `src/ui/components/setup/setup-widget.tsx`: a status line,
 * the buttons, and a line saying what a setup script is for.
 *
 * ponytail: the TUI embeds the setup tab's own terminal viewport here, sized
 * from this box. The GUI shows `↗` to promote it into a real tab instead —
 * embedding it means driving a second xterm whose size the host owns.
 */
export function SetupWidget({
  onAction,
  setup,
}: {
  setup: SetupProjection;
  onAction: (action: SetupAction) => void;
}) {
  const { exitCode, hasTab, ranAt, running, scriptExists, workspaceName } =
    setup;

  if (workspaceName === undefined) {
    return (
      <div className="tui tui-row px-[1ch]" style={{ color: theme.textMuted }}>
        No workspace
      </div>
    );
  }

  const finished = ranAt != null && ranAt !== "";
  let statusText = "not run here";
  let statusColor: string = theme.textMuted;
  if (!scriptExists) {
    statusText = "no setup script";
  } else if (running) {
    statusText = "running…";
    statusColor = theme.primary;
  } else if (finished) {
    statusText = exitCode === 0 ? "✓ setup ok" : `✗ exit ${exitCode ?? "?"}`;
    statusColor = exitCode === 0 ? theme.success : theme.error;
  }

  let runLabel = "Run";
  if (running) runLabel = "Stop";
  else if (finished) runLabel = "Re-run";

  return (
    <div className="tui flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="tui-row justify-between px-[1ch]">
        <span style={{ color: statusColor }}>{statusText}</span>
        <span className="truncate" style={{ color: theme.textMuted }}>
          {workspaceName}
        </span>
      </div>

      {/* Only Run depends on a script existing. Edit and Agent must not vanish
          the moment one does, or writing a stub and closing the editor leaves no
          way to ask an agent to fill it in — and no way out. */}
      <div className="tui-row gap-[1ch] px-[1ch] py-[--tui-row]">
        {scriptExists ? (
          <SetupButton
            action={running ? "stop" : "run"}
            label={runLabel}
            onAction={onAction}
          />
        ) : null}
        <SetupButton
          action="configure"
          label={scriptExists ? "Edit" : "Create"}
          onAction={onAction}
        />
        <SetupButton action="ask-agent" label="Agent" onAction={onAction} />
        {/* A failing setup means reading a stack trace, which a bar this narrow
            cannot do. This is the way out. */}
        {hasTab ? (
          <SetupButton action="promote" label="↗" onAction={onAction} />
        ) : null}
      </div>

      <div
        className="px-[1ch] whitespace-pre-wrap"
        style={{ color: theme.textMuted }}
      >
        {scriptExists
          ? "Runs automatically in each new workspace."
          : "A setup script installs what a fresh worktree lacks: dependencies, .env, caches."}
      </div>
    </div>
  );
}

function SetupButton({
  action,
  label,
  onAction,
}: {
  action: SetupAction;
  label: string;
  onAction: (action: SetupAction) => void;
}) {
  return (
    <Button
      variant="ghost"
      size="tui"
      onClick={() => onAction(action)}
      style={{ backgroundColor: theme.backgroundElement, color: theme.text }}
    >
      {label}
    </Button>
  );
}
