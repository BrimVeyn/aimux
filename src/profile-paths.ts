import { join } from 'node:path'

export const DEFAULT_PROFILE = 'default'

function sanitizeProfile(profile: string): string {
  const trimmed = profile.trim().toLowerCase()
  const normalized = trimmed.replace(/[^a-z0-9._-]+/g, '-')
  const collapsed = normalized.replace(/-+/g, '-').replace(/^-|-$/g, '')
  return collapsed || DEFAULT_PROFILE
}

export function getProfileName(): string {
  const configured = process.env.AIMUX_PROFILE ?? process.env.AIMUX_RUNTIME_PROFILE
  if (!configured) {
    return DEFAULT_PROFILE
  }

  return sanitizeProfile(configured)
}

export function getConfigProfilesRootDir(): string {
  return join(process.env.HOME ?? '~', '.config', 'aimux')
}

export function getProfileConfigDir(): string {
  return join(getConfigProfilesRootDir(), getProfileName())
}
