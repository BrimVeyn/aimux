import type { CliCommand } from '../registry'

import { findSkill, skillPath, SKILLS, skillStatuses } from '../../skills'
import { CliUsageError, SHARED_FLAGS } from '../flags'
import { EXIT_OK, writeJson } from '../output'

/**
 * Where the skills aimux ships actually live.
 *
 * An agent asked to author a plugin needs the skill directory before it can
 * read anything in it, and the path depends on how aimux was installed. One
 * command answers that; the alternative is every agent guessing at
 * `node_modules` layouts.
 */
export const skillList: CliCommand = {
  args: [],
  flags: SHARED_FLAGS,
  group: 'skill',
  run: async (ctx) => {
    void ctx
    writeJson({ skills: skillStatuses() })
    return await Promise.resolve(EXIT_OK)
  },
  summary: 'List the skills this aimux ships, and where they are',
  verb: 'list',
}

export const skillPathCommand: CliCommand = {
  args: [
    {
      complete: { kind: 'values', values: SKILLS.map((skill) => skill.id) },
      name: 'id',
      required: true,
    },
  ],
  flags: SHARED_FLAGS,
  group: 'skill',
  run: async (ctx) => {
    const id = ctx.args.positionals[0] ?? ''
    const skill = findSkill(id)
    if (!skill) {
      throw new CliUsageError(
        `unknown skill "${id}" — known: ${SKILLS.map((entry) => entry.id).join(', ')}`
      )
    }
    writeJson({ id: skill.id, path: skillPath(skill.id), summary: skill.summary })
    return await Promise.resolve(EXIT_OK)
  },
  summary: 'Print the directory of one shipped skill',
  verb: 'path',
}
