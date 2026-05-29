import { theme } from "@/lib/theme";
import type { SessionRecordLite, SessionStatus } from "@/lib/types";

import { Spinner } from "./Spinner";
import { AimuxButton } from "./ui/AimuxButton";

interface SessionBarProps {
  sessions: SessionRecordLite[];
  statuses: Record<string, SessionStatus>;
  currentSessionId: string | null;
  onSwitch: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}

function StatusDot({ status, active }: { status: SessionStatus | undefined; active: boolean }) {
  if (status?.working === true) {
    return <Spinner color={theme.primary} />;
  }
  if (status?.waiting === true) {
    return <span style={{ color: theme.warning }}>?</span>;
  }
  return <span style={{ color: active ? theme.primary : theme.success }}>●</span>;
}

export function SessionBar({
  sessions,
  statuses,
  currentSessionId,
  onSwitch,
  onNew,
  onDelete,
}: SessionBarProps) {
  return (
    <div
      className="flex h-8 shrink-0 items-center gap-1 overflow-x-auto border-b px-2 font-mono text-xs"
      style={{ backgroundColor: theme.backgroundPanel, borderColor: theme.border }}
    >
      {sessions.map((session, index) => {
        const active = session.id === currentSessionId;
        return (
          <div
            key={session.id}
            onMouseDown={() => onSwitch(session.id)}
            title={session.projectPath ?? session.name}
            className="group flex shrink-0 cursor-pointer items-center gap-1 rounded px-2 py-0.5"
            style={{ backgroundColor: active ? theme.backgroundElement : "transparent" }}
          >
            <StatusDot status={statuses[session.id]} active={active} />
            <span style={{ color: active ? theme.text : theme.textMuted }}>
              [{index + 1}] {session.name}
            </span>
            <AimuxButton
              className="px-1 opacity-0 group-hover:opacity-100"
              onMouseDown={(e) => {
                e.stopPropagation();
                onDelete(session.id);
              }}
              variant="ghost"
            >
              ×
            </AimuxButton>
          </div>
        );
      })}
      <div className="flex-1" />
      <AimuxButton className="shrink-0 px-2 py-0.5" onMouseDown={onNew}>
        + New
      </AimuxButton>
    </div>
  );
}
