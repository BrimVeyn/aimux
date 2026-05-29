import { theme } from "@/lib/theme";
import type { SessionMeta } from "@/lib/types";

import { Spinner } from "./Spinner";

interface SessionBarProps {
  sessions: SessionMeta[];
  currentSessionId: string | null;
  onSwitch: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}

function StatusDot({ session, active }: { session: SessionMeta; active: boolean }) {
  if (session.status?.working === true) {
    return <Spinner color={theme.primary} />;
  }
  if (session.status?.waiting === true) {
    return <span style={{ color: theme.warning }}>?</span>;
  }
  return <span style={{ color: active ? theme.primary : theme.success }}>●</span>;
}

export function SessionBar({
  sessions,
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
            title={session.path ?? session.name}
            className="group flex shrink-0 cursor-pointer items-center gap-1 rounded px-2 py-0.5"
            style={{ backgroundColor: active ? theme.backgroundElement : "transparent" }}
          >
            <StatusDot session={session} active={active} />
            <span style={{ color: active ? theme.text : theme.textMuted }}>
              [{index + 1}] {session.name}
            </span>
            <button
              type="button"
              onMouseDown={(e) => {
                e.stopPropagation();
                onDelete(session.id);
              }}
              className="opacity-0 transition-opacity group-hover:opacity-100"
              style={{ color: theme.textMuted }}
            >
              ×
            </button>
          </div>
        );
      })}
      <div className="flex-1" />
      <button
        type="button"
        onMouseDown={onNew}
        className="shrink-0 rounded px-2 py-0.5"
        style={{ backgroundColor: theme.backgroundElement, color: theme.text }}
      >
        + New
      </button>
    </div>
  );
}
