import { logDebug } from '../debug/input-log'

const NPM_REGISTRY_BASE = 'https://registry.npmjs.org'

export async function getCurrentPackageVersion(): Promise<string> {
  const { version } = await import('../../package.json')
  return version
}

export async function fetchLatestNpmVersion(packageName: string): Promise<string | null> {
  const debugOverride = process.env.AIMUX_DEBUG_UPDATE_LATEST
  if (debugOverride != null && debugOverride !== '') {
    return debugOverride
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5_000)
  try {
    const url = `${NPM_REGISTRY_BASE}/${encodeURIComponent(packageName).replace('%40', '@')}/latest`
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) {
      logDebug('update.fetchLatest.nonOk', { packageName, status: res.status })
      return null
    }
    const data = (await res.json()) as { dependencies?: Record<string, string>; version?: unknown }
    if (typeof data.version !== 'string' || data.version.length === 0) {
      return null
    }
    if (!(await siblingDepsPublished(data.dependencies ?? {}, controller.signal))) {
      logDebug('update.fetchLatest.depsNotReady', { packageName, version: data.version })
      return null
    }
    return data.version
  } catch (error) {
    logDebug('update.fetchLatest.error', {
      error: error instanceof Error ? error.message : String(error),
      packageName,
    })
    return null
  } finally {
    clearTimeout(timer)
  }
}

// A release publishes @brimveyn/aimux-config and the app seconds apart, but
// the registry serves each package's metadata from its own CDN cache (5 min).
// Until the pinned sibling version shows up in the metadata `bun install`
// reads, installing the app fails with "No version matching". Offer the update
// only once every pinned @brimveyn/* dep is installable.
async function siblingDepsPublished(
  dependencies: Record<string, string>,
  signal: AbortSignal
): Promise<boolean> {
  const pinned = Object.entries(dependencies).filter(([name]) => name.startsWith('@brimveyn/'))
  const results = await Promise.all(
    pinned.map(async ([name, version]) => {
      const res = await fetch(`${NPM_REGISTRY_BASE}/${name}`, {
        headers: { Accept: 'application/vnd.npm.install-v1+json' },
        signal,
      })
      if (!res.ok) return false
      const data = (await res.json()) as { versions?: Record<string, unknown> }
      return data.versions?.[version] !== undefined
    })
  )
  return results.every(Boolean)
}

function parseSemver(version: string): number[] | null {
  const trimmed = version.trim().replace(/^v/, '')
  const core = trimmed.split(/[-+]/)[0] ?? ''
  const parts = core.split('.')
  if (parts.length === 0) return null
  const numeric: number[] = []
  for (const part of parts) {
    const n = Number.parseInt(part, 10)
    if (!Number.isFinite(n) || n < 0) return null
    numeric.push(n)
  }
  return numeric
}

export function isNewerVersion(latest: string, current: string): boolean {
  const a = parseSemver(latest)
  const b = parseSemver(current)
  if (!a || !b) return false

  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0
    const bv = b[i] ?? 0
    if (av > bv) return true
    if (av < bv) return false
  }
  return false
}
