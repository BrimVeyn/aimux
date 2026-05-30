import { theme } from "@/lib/theme";
import type {
  AIUsageTool,
  UsagePaceStage,
  UsageSnapshot,
  UsageWindow,
} from "@/lib/types";

// Browser-side reproduction of the TUI usage modal
// (src/ui/components/modals/app/ai-usage-modal.tsx): per-tool sections with a
// 32-segment bar per rate-limit window, percent used, reset time, and pace.

const TOOL_TITLE: Record<AIUsageTool, string> = {
  claude: "Claude",
  codex: "Codex",
};

const BAR_SEGMENTS = 32;
const BAR_FILLED_CHAR = "\u{2501}";
const BAR_EMPTY_CHAR = "\u{2500}";

function buildBar(percent: number | null): { empty: string; filled: string } {
  const p = percent ?? 0;
  let filledCount = 0;
  for (let i = 0; i < BAR_SEGMENTS; i++) {
    if (p > i * (100 / BAR_SEGMENTS)) filledCount++;
  }
  return {
    empty: BAR_EMPTY_CHAR.repeat(BAR_SEGMENTS - filledCount),
    filled: BAR_FILLED_CHAR.repeat(filledCount),
  };
}

function formatRelative(iso: string, now: number = Date.now()): string {
  const diffMs = now - new Date(iso).getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return "just now";
  const s = Math.floor(diffMs / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function paceStageIsAhead(stage: UsagePaceStage): boolean {
  return stage === "ahead" || stage === "farAhead" || stage === "slightlyAhead";
}

function paceStageIsBehind(stage: UsagePaceStage): boolean {
  return stage === "behind" || stage === "farBehind" || stage === "slightlyBehind";
}

function PaceLine({ pace }: { pace: NonNullable<UsageWindow["pace"]> }) {
  let color: string = theme.textMuted;
  if (paceStageIsBehind(pace.stage)) color = theme.warning;
  else if (paceStageIsAhead(pace.stage)) color = theme.success;

  const suffix =
    pace.rightText !== null && pace.rightText !== "" ? ` · ${pace.rightText}` : "";
  return <div style={{ color }}>{`Pace: ${pace.label}${suffix}`}</div>;
}

function WindowRow({ window }: { window: UsageWindow }) {
  const percent = window.percent;
  const { empty, filled } = buildBar(percent);

  let barColor: string = theme.success;
  if (percent !== null) {
    if (percent >= 85) barColor = theme.error;
    else if (percent >= 60) barColor = theme.warning;
  }

  const pctText = percent === null ? "—" : `${Math.round(percent)}% used`;
  const resetText =
    window.timeRemaining !== null && window.timeRemaining !== ""
      ? `Resets in ${window.timeRemaining}`
      : null;

  return (
    <div className="flex flex-col pt-1">
      <div style={{ color: theme.text }}>{window.label}</div>
      <div className="whitespace-pre">
        <span style={{ color: barColor }}>{filled}</span>
        <span style={{ color: theme.textMuted }}>{empty}</span>
      </div>
      <div className="flex flex-row justify-between">
        <span style={{ color: theme.textMuted }}>{pctText}</span>
        {resetText !== null ? (
          <span style={{ color: theme.textMuted }}>{resetText}</span>
        ) : null}
      </div>
      {window.pace !== null ? <PaceLine pace={window.pace} /> : null}
    </div>
  );
}

function ToolSection({
  snap,
  tool,
}: {
  snap: UsageSnapshot;
  tool: AIUsageTool;
}) {
  const isHardError = Boolean(snap.error) && snap.stale !== true;
  const relative = formatRelative(snap.lastUpdated);

  return (
    <div className="flex flex-col">
      <div className="flex flex-row justify-between">
        <span style={{ color: theme.text }}>{TOOL_TITLE[tool]}</span>
        {snap.planTier !== null && snap.planTier !== "" ? (
          <span style={{ color: theme.textMuted }}>{snap.planTier}</span>
        ) : null}
      </div>
      <div style={{ color: theme.textMuted }}>{`Updated ${relative}`}</div>
      {isHardError ? (
        <div style={{ color: theme.error }}>{`error: ${snap.error ?? ""}`}</div>
      ) : snap.windows.length === 0 ? (
        <div style={{ color: theme.textMuted }}>no window data</div>
      ) : (
        snap.windows.map((w) => <WindowRow key={w.kind} window={w} />)
      )}
    </div>
  );
}

export function AIUsageModal({
  snapshots,
}: {
  snapshots: Partial<Record<AIUsageTool, UsageSnapshot>>;
}) {
  const tools: AIUsageTool[] = ["claude", "codex"];
  const sections = tools
    .map((tool) => ({ snap: snapshots[tool], tool }))
    .filter((s): s is { snap: UsageSnapshot; tool: AIUsageTool } => s.snap !== undefined);

  return (
    <div className="flex flex-col gap-2">
      <div className="font-bold">AI usage</div>
      {sections.length === 0 ? (
        <div style={{ color: theme.textMuted }}>no data yet — collecting…</div>
      ) : (
        <div className="flex flex-col gap-2">
          {sections.map(({ snap, tool }) => (
            <ToolSection key={tool} snap={snap} tool={tool} />
          ))}
        </div>
      )}
    </div>
  );
}
