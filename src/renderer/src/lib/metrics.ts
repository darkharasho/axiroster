import type { BridgePlayerMetrics, CommanderStats } from '../../../preload/index.d'

export interface AggregatedMetrics {
  mainClass: string | null
  classSpread: Record<string, number>
  raidsAttended: number
  raidsConsidered: number
  combatTimeMs: number
  squadTimeMs: number
  lastSeen: string | null
  commander: CommanderStats | null
  /** Per-account contribution so the UI can show the grouping. */
  perAccount: { account: string; m: BridgePlayerMetrics }[]
}

function topKey(spread: Record<string, number>): string | null {
  let best: string | null = null
  let bestN = -1
  for (const [k, n] of Object.entries(spread)) if (n > bestN) ((best = k), (bestN = n))
  return best
}

function maxIso(a: string | null, b: string | null): string | null {
  if (!a) return b
  if (!b) return a
  return a > b ? a : b
}

function mergeCommander(a: CommanderStats | null, b: CommanderStats): CommanderStats {
  if (!a) return b
  const kills = a.kills + b.kills
  const deaths = a.deaths + b.deaths
  return {
    runs: a.runs + b.runs,
    fightsLed: a.fightsLed + b.fightsLed,
    kills,
    downs: a.downs + b.downs,
    deaths,
    wins: a.wins + b.wins,
    losses: a.losses + b.losses,
    kdr: deaths > 0 ? kills / deaths : kills
  }
}

/**
 * Combine AxiBridge metrics across ALL of a member's GW2 accounts (people run
 * several accounts; their WvW activity should read as one person). Returns null
 * when none of the accounts have bridge data.
 *
 * Caveat: without per-raid data we can't dedupe raids a person attended on two
 * accounts, so raidsAttended is summed and capped at the considered window.
 */
export function aggregateMemberMetrics(
  accounts: { account_name: string }[],
  metrics: Record<string, BridgePlayerMetrics>
): AggregatedMetrics | null {
  const perAccount: { account: string; m: BridgePlayerMetrics }[] = []
  for (const a of accounts) {
    const m = metrics[a.account_name.toLowerCase()]
    if (m) perAccount.push({ account: a.account_name, m })
  }
  if (perAccount.length === 0) return null

  const classSpread: Record<string, number> = {}
  let raidsAttended = 0
  let raidsConsidered = 0
  let combatTimeMs = 0
  let squadTimeMs = 0
  let lastSeen: string | null = null
  let commander: CommanderStats | null = null

  for (const { m } of perAccount) {
    for (const [k, n] of Object.entries(m.classSpread)) classSpread[k] = (classSpread[k] ?? 0) + n
    raidsAttended += m.raidsAttended
    raidsConsidered = Math.max(raidsConsidered, m.raidsConsidered)
    combatTimeMs += m.combatTimeMs
    squadTimeMs += m.squadTimeMs
    lastSeen = maxIso(lastSeen, m.lastSeen)
    if (m.commander) commander = mergeCommander(commander, m.commander)
  }

  return {
    mainClass: topKey(classSpread),
    classSpread,
    // cap attendance at the window so multi-account play can't exceed 100%
    raidsAttended: raidsConsidered > 0 ? Math.min(raidsAttended, raidsConsidered) : raidsAttended,
    raidsConsidered,
    combatTimeMs,
    squadTimeMs,
    lastSeen,
    commander,
    perAccount
  }
}
