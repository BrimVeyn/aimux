import type { UsageDay, UsageDays, UsageTokens } from './store'

/**
 * Notional cost of the recorded tokens.
 *
 * Nothing here is a charge. Claude Code and Codex run on subscriptions, not
 * metered API billing, so these numbers answer one question only: what would
 * this usage have cost at API list price. Every surface that renders them says
 * "estimated" for that reason.
 */

export interface ModelRate {
  /** USD per million input tokens. */
  input: number
  /** USD per million output tokens. */
  output: number
}

const MILLION = 1_000_000

/**
 * List prices, matched by id prefix so dated snapshots
 * (`claude-sonnet-4-5-20250929`) hit the same row as the alias. Longest prefix
 * wins, so `claude-opus-4-6` is not shadowed by a shorter `claude-opus` entry —
 * there deliberately isn't one. A model whose price is not published here is
 * left out of the total rather than guessed at.
 */
const RATES: [prefix: string, rate: ModelRate][] = [
  ['claude-fable-5', { input: 10, output: 50 }],
  ['claude-mythos-5', { input: 10, output: 50 }],
  ['claude-opus-5', { input: 5, output: 25 }],
  ['claude-opus-4-8', { input: 5, output: 25 }],
  ['claude-opus-4-7', { input: 5, output: 25 }],
  ['claude-opus-4-6', { input: 5, output: 25 }],
  ['claude-sonnet-5', { input: 3, output: 15 }],
  ['claude-sonnet-4-6', { input: 3, output: 15 }],
  ['claude-haiku-4-5', { input: 1, output: 5 }],
]

/** Cache reads bill at a tenth of the input rate; writes at 1.25x (the 5-minute TTL). */
const CACHE_READ_MULTIPLIER = 0.1
const CACHE_WRITE_MULTIPLIER = 1.25

export function rateFor(model: string): ModelRate | null {
  let best: ModelRate | null = null
  let bestLength = 0
  for (const [prefix, rate] of RATES) {
    if (model.startsWith(prefix) && prefix.length > bestLength) {
      best = rate
      bestLength = prefix.length
    }
  }
  return best
}

export function costOf(tokens: UsageTokens, rate: ModelRate): number {
  return (
    (tokens.input * rate.input +
      tokens.output * rate.output +
      tokens.cacheRead * rate.input * CACHE_READ_MULTIPLIER +
      tokens.cacheWrite * rate.input * CACHE_WRITE_MULTIPLIER) /
    MILLION
  )
}

/** What the cache reads would have cost at the full input rate, minus what they did cost. */
export function savedByCache(tokens: UsageTokens, rate: ModelRate): number {
  return (tokens.cacheRead * rate.input * (1 - CACHE_READ_MULTIPLIER)) / MILLION
}

function scale(tokens: UsageTokens, factor: number): UsageTokens {
  return {
    cacheRead: tokens.cacheRead * factor,
    cacheWrite: tokens.cacheWrite * factor,
    input: tokens.input * factor,
    output: tokens.output * factor,
    total: tokens.total * factor,
  }
}

export interface CostBreakdown {
  saved: number
  total: number
  /**
   * Tokens `total` does not cover, so a page can say so instead of presenting a
   * partial sum as the whole bill. Two ways in: a model with no published rate
   * (every Codex model, today), and tokens no model claimed at all.
   */
  unpricedTokens: number
}

function emptyBreakdown(): CostBreakdown {
  return { saved: 0, total: 0, unpricedTokens: 0 }
}

/**
 * A day's cost, split across its models in proportion to their token share.
 *
 * ponytail: the store keeps one total per model, not an input/output/cache split
 * per model, so a day's overall split is applied to each model's share. Exact
 * whenever a day used one model — the common case — and off only when a day
 * mixes tiers whose input/output ratios also differ. Storing `UsageTokens` per
 * model would make it exact, at the cost of a wider file and another migration;
 * do that if the estimate is ever visibly wrong.
 */
export function dayCost(day: UsageDay): CostBreakdown {
  const result = emptyBreakdown()
  const { total } = day.tokens
  if (total <= 0) return result

  let attributed = 0
  for (const [model, modelTotal] of Object.entries(day.models)) {
    attributed += modelTotal
    const rate = rateFor(model)
    if (rate === null) {
      result.unpricedTokens += modelTotal
      continue
    }
    const share = scale(day.tokens, modelTotal / total)
    result.total += costOf(share, rate)
    result.saved += savedByCache(share, rate)
  }

  // Tokens no model claimed: a Codex transcript whose `model` line never
  // appeared, or a day whose attribution was pruned out from under its totals.
  // Unpriced for the same reason a missing rate is — nothing here knows what
  // they cost — and counting them is what keeps the loop above from silently
  // dropping a day's tokens out of the accounting altogether.
  result.unpricedTokens += Math.max(0, total - attributed)

  return result
}

export function totalCost(days: UsageDays): CostBreakdown {
  const result = emptyBreakdown()
  for (const day of Object.values(days)) {
    const cost = dayCost(day)
    result.saved += cost.saved
    result.total += cost.total
    result.unpricedTokens += cost.unpricedTokens
  }
  return result
}

export function formatUsd(amount: number): string {
  if (amount >= 1000) return `$${Math.round(amount).toLocaleString('en-US').replaceAll(',', ' ')}`
  if (amount >= 10) return `$${amount.toFixed(0)}`
  return `$${amount.toFixed(2)}`
}
