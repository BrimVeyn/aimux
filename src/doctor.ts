import { existsSync } from 'node:fs'

import { CONFIG_PATH, loadConfigResult } from './config'
import { ASSISTANT_OPTIONS, isCommandAvailable, parseCommand } from './pty/command-registry'

export interface DoctorCheck {
  name: string
  ok: boolean
  details: string
}

export interface DoctorReport {
  checks: DoctorCheck[]
}

function formatStatus(ok: boolean): string {
  return ok ? 'OK' : 'WARN'
}

function getConfigDetails(configResult: ReturnType<typeof loadConfigResult>): string {
  if (configResult.issues.length > 0) {
    return configResult.issues.join('; ')
  }

  if (existsSync(CONFIG_PATH)) {
    return `loaded ${CONFIG_PATH}`
  }

  return `using defaults (${CONFIG_PATH} not found)`
}

function getAssistantDetails(
  configuredCommand: string,
  args: string[],
  executable: string
): string {
  if (executable.length === 0) {
    return 'empty command'
  }

  return args.length > 0 ? `${configuredCommand} (${args.length} args)` : configuredCommand
}

function getSummaryLine(failedChecks: DoctorCheck[]): string {
  if (failedChecks.length === 0) {
    return 'All core checks passed.'
  }

  return `${failedChecks.length} check(s) need attention before aimux will work reliably.`
}

export function buildDoctorReport(): DoctorReport {
  const configResult = loadConfigResult()
  const config = configResult.config
  const checks: DoctorCheck[] = []

  checks.push({
    details: `${process.platform} ${process.arch}`,
    name: 'platform',
    ok: process.platform === 'darwin' || process.platform === 'linux',
  })

  checks.push({
    details: Bun.version,
    name: 'bun',
    ok: typeof Bun.version === 'string' && Bun.version.length > 0,
  })

  checks.push({
    details: getConfigDetails(configResult),
    name: 'config',
    ok: configResult.issues.length === 0,
  })

  for (const option of ASSISTANT_OPTIONS) {
    const configuredCommand = config.customCommands[option.id] ?? option.command
    const { args, executable } = parseCommand(configuredCommand)
    checks.push({
      details: getAssistantDetails(configuredCommand, args, executable),
      name: `assistant:${option.id}`,
      ok: executable.length > 0 && isCommandAvailable(executable),
    })
  }

  return { checks }
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines = ['aimux doctor', '']

  for (const check of report.checks) {
    lines.push(`${formatStatus(check.ok).padEnd(4)} ${check.name} - ${check.details}`)
  }

  const failedChecks = report.checks.filter((check) => !check.ok)
  lines.push('')
  lines.push(getSummaryLine(failedChecks))

  return lines.join('\n')
}

export function runDoctor(): number {
  const report = buildDoctorReport()
  process.stdout.write(`${formatDoctorReport(report)}\n`)
  return report.checks.every((check) => check.ok) ? 0 : 1
}
