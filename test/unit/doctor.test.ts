import { describe, expect, test } from 'bun:test'

import { buildDoctorReport, formatDoctorReport } from '../../src/doctor'

describe('doctor', () => {
  test('buildDoctorReport includes core checks', () => {
    const report = buildDoctorReport()
    const names = report.checks.map((check) => check.name)

    expect(names).toContain('platform')
    expect(names).toContain('bun')
    expect(names).toContain('config')
    expect(names).toContain('assistant:claude')
    expect(names).toContain('assistant:codex')
    expect(names).toContain('assistant:opencode')
  })

  test('formatDoctorReport renders readable output', () => {
    const output = formatDoctorReport({
      checks: [
        { details: 'darwin arm64', name: 'platform', ok: true },
        { details: 'claude', name: 'assistant:claude', ok: false },
      ],
    })

    expect(output).toContain('aimux doctor')
    expect(output).toContain('OK   platform - darwin arm64')
    expect(output).toContain('WARN assistant:claude - claude')
    expect(output).toContain('1 check(s) need attention')
  })
})
