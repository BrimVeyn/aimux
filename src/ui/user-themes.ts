import { isKnownThemeId, registerTuiTheme, type TuiThemeJson } from '@brimveyn/aimux-config'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'

import { logDebug } from '../debug/input-log'
import { getProfileConfigDir } from '../profile-paths'

/**
 * Themes dropped into `<profile>/themes/*.json`, loaded at boot.
 *
 * The same shape the shipped themes use, so an author can copy one out of the
 * package, edit it, and drop it in — which is the whole point: the shipped
 * registry is a static import list, and nothing short of a rebuild could add
 * to it.
 *
 * Deliberately not watched. A theme file changes when someone is editing it,
 * and re-registering under the same id mid-edit would have to invalidate the
 * resolved theme store; `aimux plugin reload` and a restart both already do
 * the right thing.
 */

export function getUserThemesDir(): string {
  return join(getProfileConfigDir(), 'themes')
}

export interface UserThemeIssue {
  file: string
  message: string
}

export interface LoadedUserThemes {
  ids: string[]
  issues: UserThemeIssue[]
  /** Unregisters every theme this call registered. */
  dispose: () => void
}

/**
 * The shipped themes are plain JSON with a `theme` map of colour tokens. This
 * checks the shape rather than every token: a theme missing a token falls back
 * the same way a shipped one would, but a file that is not a theme at all
 * should say so instead of resolving to a screen of defaults.
 */
function looksLikeTheme(value: unknown): value is TuiThemeJson {
  if (typeof value !== 'object' || value === null) return false
  const theme = (value as { theme?: unknown }).theme
  return typeof theme === 'object' && theme !== null
}

export function loadUserThemes(): LoadedUserThemes {
  const dir = getUserThemesDir()
  const issues: UserThemeIssue[] = []
  const ids: string[] = []
  const disposers: (() => void)[] = []

  if (!existsSync(dir)) return { dispose: () => {}, ids, issues }

  let files: string[]
  try {
    files = readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .sort()
  } catch (error) {
    return {
      dispose: () => {},
      ids,
      issues: [{ file: dir, message: error instanceof Error ? error.message : String(error) }],
    }
  }

  for (const file of files) {
    // The filename is the id, the way the shipped registry keys its imports.
    const id = basename(file, '.json')
    if (isKnownThemeId(id)) {
      issues.push({ file, message: `"${id}" is already a theme id; rename the file` })
      continue
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(join(dir, file), 'utf8'))
    } catch (error) {
      issues.push({
        file,
        message: `not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      })
      continue
    }

    if (!looksLikeTheme(parsed)) {
      issues.push({ file, message: 'missing a "theme" object of colour tokens' })
      continue
    }

    try {
      disposers.push(registerTuiTheme(id, parsed))
      ids.push(id)
    } catch (error) {
      issues.push({ file, message: error instanceof Error ? error.message : String(error) })
    }
  }

  logDebug('themes.user.loaded', { dir, ids, issues: issues.length })

  return {
    dispose: () => {
      for (let i = disposers.length - 1; i >= 0; i--) disposers[i]?.()
    },
    ids,
    issues,
  }
}
