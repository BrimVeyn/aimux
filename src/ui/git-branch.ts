import { $ } from 'bun'

export async function getCurrentBranch(cwd: string): Promise<string | null> {
  try {
    const result = await $`git -C ${cwd} branch --show-current`.quiet()
    const branch = result.text().trim()
    return branch || null
  } catch {
    return null
  }
}
