import { appendFileSync } from "node:fs";

const INPUT_DEBUG_LOG_PATH = "/tmp/aimux-input-debug.log";

function serialize(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  return JSON.stringify(value);
}

export function logInputDebug(event: string, details?: Record<string, unknown>): void {
  try {
    const line = `${new Date().toISOString()} ${event}${details ? ` ${serialize(details)}` : ""}\n`;
    appendFileSync(INPUT_DEBUG_LOG_PATH, line);
  } catch {
    // Best-effort debug logging only.
  }
}

export { INPUT_DEBUG_LOG_PATH };
