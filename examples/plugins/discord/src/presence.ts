/**
 * Two lines of text, from whatever the tabs are doing.
 *
 * Kept apart from the socket because this is the part with an opinion in it —
 * which of three states wins, what a person reading a profile wants to know
 * first — and the part worth a test.
 */

export type TabStatus = 'working' | 'waiting-input' | 'idle'

export interface TrackedTab {
  projectId: string
  assistant: string
  status: TabStatus
}

/** The subset of Discord's activity object this plugin fills in. */
export interface DiscordActivity {
  details: string
  state: string
  timestamps: { start: number }
  assets?: { large_image?: string; large_text?: string }
}

/** Discord refuses a field over 128 characters rather than trimming it. */
const MAX_FIELD = 128

export function fit(value: string): string {
  return value.length <= MAX_FIELD ? value : `${value.slice(0, MAX_FIELD - 1)}…`
}

function agents(count: number): string {
  return `${count} agent${count === 1 ? '' : 's'}`
}

/**
 * One state wins, and it is the one you would want to be told: an agent
 * blocked on you outranks any amount of work in progress, which outranks a
 * quiet session.
 */
export function summarize(tabs: readonly TrackedTab[]): string {
  const waiting = tabs.filter((tab) => tab.status === 'waiting-input').length
  if (waiting > 0) return `${agents(waiting)} waiting on input`
  const working = tabs.filter((tab) => tab.status === 'working').length
  if (working > 0) return `${agents(working)} working`
  if (tabs.length > 0) return `${agents(tabs.length)} idle`
  return 'no agents running'
}

export function buildActivity(input: {
  tabs: readonly TrackedTab[]
  /** Null when there is no project, or when the user asked not to publish it. */
  projectName: string | null
  startedAt: number
  largeImage: string
}): DiscordActivity {
  const names = [...new Set(input.tabs.map((tab) => tab.assistant))].sort().join(' · ')
  const assets = {
    ...(input.largeImage === '' ? {} : { large_image: input.largeImage }),
    ...(names === '' ? {} : { large_text: names }),
  }
  return {
    ...(Object.keys(assets).length === 0 ? {} : { assets }),
    details: fit(input.projectName ?? 'aimux'),
    state: fit(summarize(input.tabs)),
    timestamps: { start: input.startedAt },
  }
}
