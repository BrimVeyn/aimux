import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { WorkspaceSnapshotV1 } from "./state/session-persistence";

export const CONFIG_PATH = join(process.env.HOME ?? "~", ".config", "aimux.json");

export interface AimuxConfig {
  version: 2;
  customCommands: Record<string, string>;
  workspaceSnapshot?: WorkspaceSnapshotV1;
}

const DEFAULT_CONFIG: AimuxConfig = {
  version: 2,
  customCommands: {},
};

function isWorkspaceSnapshotV1(value: unknown): value is WorkspaceSnapshotV1 {
  return typeof value === "object" && value !== null && (value as { version?: number }).version === 1;
}

export function loadConfig(): AimuxConfig {
  try {
    if (existsSync(CONFIG_PATH)) {
      const raw = readFileSync(CONFIG_PATH, "utf8");
      const parsed = JSON.parse(raw) as {
        version?: number;
        customCommands?: Record<string, string>;
        workspaceSnapshot?: unknown;
      };
      return {
        version: 2,
        customCommands: parsed.customCommands ?? {},
        workspaceSnapshot: isWorkspaceSnapshotV1(parsed.workspaceSnapshot) ? parsed.workspaceSnapshot : undefined,
      };
    }
  } catch {
    // ignore missing or malformed config
  }
  return DEFAULT_CONFIG;
}

export function saveConfig(config: AimuxConfig): void {
  try {
    mkdirSync(dirname(CONFIG_PATH), { recursive: true });
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
  } catch {
    // ignore write errors silently
  }
}
