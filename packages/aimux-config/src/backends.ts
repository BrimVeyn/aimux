import type { BackendConfig } from './types'

/**
 * Create a Claude backend configuration.
 * Stub — runtime wiring deferred to follow-up work.
 */
export function claudeBackend(opts?: { model?: string }): BackendConfig {
  return {
    args: opts?.model != null && opts.model !== '' ? ['--model', opts.model] : [],
    command: 'claude',
  }
}

/**
 * Create a Codex backend configuration.
 * Stub — runtime wiring deferred to follow-up work.
 */
export function codexBackend(opts?: { args?: string[] }): BackendConfig {
  return {
    args: opts?.args ?? [],
    command: 'codex',
  }
}
