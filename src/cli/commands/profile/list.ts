import { readdirSync } from 'node:fs'

import type { CliCommand } from '../../registry'

import { listRunningProfiles, resolveAmbientProfile } from '../../../profile-detect'
import { getConfigProfilesRootDir } from '../../../profile-paths'
import { SHARED_FLAGS } from '../../flags'
import { EXIT_OK, writeJson } from '../../output'

/**
 * Which profiles exist, which are running, and which one a bare command will
 * talk to.
 *
 * The first line of an agent's session: without it, everything it does lands
 * in whichever profile `AIMUX_PROFILE` happened to name — which, in a shell
 * that never exported it, is not the one the user is looking at.
 */
export const profileList: CliCommand = {
  args: [],
  flags: [
    ...SHARED_FLAGS,
    { description: 'Only the profiles with a live daemon', kind: 'boolean', name: 'running' },
  ],
  group: 'profile',
  run: async (ctx) => {
    const running = listRunningProfiles()
    const choice = resolveAmbientProfile()

    if (ctx.args.flags.running === true) {
      writeJson({ active: choice.profile, activeFrom: choice.from, running })
      return EXIT_OK
    }

    let known: string[] = []
    try {
      known = readdirSync(getConfigProfilesRootDir(), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
    } catch {
      known = []
    }

    writeJson({
      active: choice.profile,
      // `only-running` is the interesting one: nothing was asked for, and a
      // single live aimux answered for itself.
      activeFrom: choice.from,
      profiles: known.map((profile) => ({ profile, running: running.includes(profile) })),
      running,
    })
    return EXIT_OK
  },
  summary: 'Profiles on this machine, which are running, and which one commands use',
  verb: 'list',
}
