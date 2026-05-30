import { theme } from "@/lib/theme";
import type { SessionRecordLite, SessionStatus } from "@/lib/types";

import { Spinner } from "./Spinner";

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
    return (
      <span className="inline-flex h-2 w-2 items-center justify-center">
        <Spinner color={theme.primary} />
      </span>
    );
  }
  const color =
    status?.waiting === true ? theme.warning : active ? theme.primary : theme.success;
  return (
    <span
      aria-hidden
      className="inline-block h-1.5 w-1.5 rounded-full"
      style={{ backgroundColor: color }}
    />
  );
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
      className="relative z-[60] flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-b px-3"
      style={{ backgroundColor: theme.backgroundPanel, borderColor: theme.border }}
    >
      {sessions.map((session, index) => {
        const active = session.id === currentSessionId;
        return (
          <div
            key={session.id}
            onMouseDown={() => onSwitch(session.id)}
            title={`[${index + 1}] ${session.projectPath ?? session.name}`}
            className="group relative flex shrink-0 cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5 transition-[background-color] duration-150 ease-out"
            style={{
              backgroundColor: active
                ? theme.backgroundElement
                : "transparent",
            }}
            onMouseEnter={(e) => {
              if (!active) {
                e.currentTarget.style.backgroundColor = `color-mix(in oklab, ${theme.backgroundElement} 55%, transparent)`;
              }
            }}
            onMouseLeave={(e) => {
              if (!active) {
                e.currentTarget.style.backgroundColor = "transparent";
              }
            }}
          >
            {active ? (
              <span
                aria-hidden
                className="pointer-events-none absolute top-0 left-3 right-3 h-[1.5px] rounded-full"
                style={{ backgroundColor: theme.primary }}
              />
            ) : null}

            <StatusDot status={statuses[session.id]} active={active} />

            <span
              className="chrome-label truncate max-w-[180px]"
              style={{ color: active ? theme.text : theme.textMuted }}
            >
              {session.name}
            </span>

            <span
              className="chrome-code opacity-0 group-hover:opacity-100 transition-opacity duration-150"
              style={{ color: theme.textMuted }}
            >
              {index + 1}
            </span>

            <button
              type="button"
              aria-label="Close session"
              onMouseDown={(e) => {
                e.stopPropagation();
                onDelete(session.id);
              }}
              className="flex h-[18px] w-[18px] items-center justify-center rounded-full opacity-0 transition-[opacity,background-color,transform] duration-150 ease-out group-hover:opacity-100 hover:scale-100 scale-90"
              style={{ color: theme.textMuted }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = `color-mix(in oklab, ${theme.error} 18%, transparent)`;
                e.currentTarget.style.color = theme.text;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "transparent";
                e.currentTarget.style.color = theme.textMuted;
              }}
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
        );
      })}
      <div className="flex-1" />
      <NewSessionButton onClick={onNew} />
    </div>
  );
}

function NewSessionButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onMouseDown={onClick}
      className="group flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 transition-[background-color,color] duration-150 ease-out"
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
      <span className="chrome-label">New session</span>
    </button>
  );
}
