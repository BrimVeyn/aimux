import { existsSync } from "node:fs";

import { CONFIG_PATH, loadConfig } from "./config";
import { ASSISTANT_OPTIONS, isCommandAvailable, parseCommand } from "./pty/command-registry";

export interface DoctorCheck {
  name: string;
  ok: boolean;
  details: string;
}

export interface DoctorReport {
  checks: DoctorCheck[];
}

function formatStatus(ok: boolean): string {
  return ok ? "OK" : "WARN";
}

export function buildDoctorReport(): DoctorReport {
  const config = loadConfig();
  const checks: DoctorCheck[] = [];

  checks.push({
    name: "platform",
    ok: process.platform === "darwin" || process.platform === "linux",
    details: `${process.platform} ${process.arch}`,
  });

  checks.push({
    name: "bun",
    ok: typeof Bun.version === "string" && Bun.version.length > 0,
    details: Bun.version,
  });

  checks.push({
    name: "config",
    ok: true,
    details: existsSync(CONFIG_PATH)
      ? `loaded ${CONFIG_PATH}`
      : `using defaults (${CONFIG_PATH} not found)`,
  });

  for (const option of ASSISTANT_OPTIONS) {
    const configuredCommand = config.customCommands[option.id] ?? option.command;
    const { executable, args } = parseCommand(configuredCommand);
    checks.push({
      name: `assistant:${option.id}`,
      ok: executable.length > 0 && isCommandAvailable(executable),
      details:
        executable.length === 0
          ? "empty command"
          : `${configuredCommand}${args.length > 0 ? ` (${args.length} args)` : ""}`,
    });
  }

  return { checks };
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines = ["aimux doctor", ""];

  for (const check of report.checks) {
    lines.push(`${formatStatus(check.ok).padEnd(4)} ${check.name} - ${check.details}`);
  }

  const failedChecks = report.checks.filter((check) => !check.ok);
  lines.push("");
  lines.push(
    failedChecks.length === 0
      ? "All core checks passed."
      : `${failedChecks.length} check(s) need attention before aimux will work reliably.`,
  );

  return lines.join("\n");
}

export function runDoctor(): number {
  const report = buildDoctorReport();
  console.log(formatDoctorReport(report));
  return report.checks.every((check) => check.ok) ? 0 : 1;
}
