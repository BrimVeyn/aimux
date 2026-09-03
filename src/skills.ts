import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * The skills aimux ships.
 *
 * A skill is a directory of instructions an agent reads before doing a job it
 * would otherwise improvise. They travel inside the npm package, so their path
 * depends on where aimux was installed — resolved once, here, rather than
 * spelled out again by every command that wants to name one.
 *
 * The registry also gives `aimux doctor` something to check. A skill that did
 * not survive packaging is invisible until an agent reads a stale copy or none
 * at all, and neither failure announces itself.
 */

export interface SkillDefinition {
  /** Directory name under `skills/`, and the id the CLI takes. */
  id: string
  summary: string
}

export const SKILLS: readonly SkillDefinition[] = [
  {
    id: 'aimux-orchestrator',
    summary: 'Decompose a plan, run isolated workers, review and integrate their diffs',
  },
  {
    id: 'aimux-plugin-author',
    summary: 'Write, test and ship an aimux plugin against the plugin API',
  },
]

/** Absolute path to a shipped skill's directory. Does not check it exists. */
export function skillPath(id: string): string {
  return fileURLToPath(new URL(`../skills/${id}/`, import.meta.url))
}

export function findSkill(id: string): SkillDefinition | undefined {
  return SKILLS.find((skill) => skill.id === id)
}

export interface SkillStatus extends SkillDefinition {
  path: string
  present: boolean
}

export function skillStatuses(): SkillStatus[] {
  return SKILLS.map((skill) => {
    const path = skillPath(skill.id)
    return { ...skill, path, present: existsSync(path) }
  })
}
