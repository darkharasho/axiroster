// src/main/axibridgeClient.ts
//
// AxiBridge is a desktop app that watches arcdps WvW logs and publishes combat
// reports as static JSON to a GitHub repo (raw.githubusercontent + GitHub Pages).
// It is NOT a server — AxiRoster reads the published artifacts read-only:
//
//   reports/index.json          list of runs (id, title, commanders, dates, sizes)
//   reports/rollup.json         per-account aggregate across recent runs
//   reports/<runId>/report.json full per-run detail
//
// This client fetches the rollup and folds it into a per-account metrics shape
// the roster overlays onto each member: main class, class spread, raid
// attendance, time in raids, last seen. Parsing is defensive — the rollup schema
// evolves, so unknown fields are ignored and missing ones degrade gracefully.

import { resilientFetch, FetchTimeoutError } from './net/resilientFetch'

export class AxibridgeError extends Error {}

/** A published AxiBridge repo, e.g. { owner: 'myguild', repo: 'wvw-reports' }. */
export interface RepoRef {
  owner: string
  repo: string
}

/** Per-GW2-account metrics aggregated across the rollup window. */
export interface BridgePlayerMetrics {
  accountName: string
  /** Most-played profession in the window. */
  mainClass: string | null
  /** profession -> number of runs seen on it (the class spread). */
  classSpread: Record<string, number>
  /** Distinct runs this account appeared in. */
  raidsAttended: number
  /** Total runs in the rollup window (denominator for attendance %). */
  raidsConsidered: number
  /** Total active combat time across runs, in milliseconds. */
  combatTimeMs: number
  /** Total time in squad across runs, in milliseconds. */
  squadTimeMs: number
  /** ISO timestamp this account was last seen in a run, or null. */
  lastSeen: string | null
}

const BRANCHES = ['main', 'master', 'gh-pages']
const lc = (s: string): string => s.trim().toLowerCase()

export class AxibridgeClient {
  constructor(private readonly repos: RepoRef[]) {}

  private candidateUrls(repo: RepoRef, relPath: string): string[] {
    return [
      ...BRANCHES.map(
        (b) => `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${b}/${relPath}`
      ),
      `https://${repo.owner}.github.io/${repo.repo}/${relPath}`
    ]
  }

  /** Fetch a JSON artifact, trying each branch/Pages URL until one responds OK. */
  private async fetchJson(repo: RepoRef, relPath: string): Promise<unknown | null> {
    for (const url of this.candidateUrls(repo, relPath)) {
      try {
        const resp = await resilientFetch(url, { timeoutMs: 8000 })
        if (resp.ok) return await resp.json().catch(() => null)
      } catch (err) {
        if (err instanceof FetchTimeoutError) continue
      }
    }
    return null
  }

  /** Merged per-account metrics across all configured repos, keyed by lc(account). */
  async playerMetrics(): Promise<Map<string, BridgePlayerMetrics>> {
    const out = new Map<string, BridgePlayerMetrics>()
    for (const repo of this.repos) {
      const rollup = await this.fetchJson(repo, 'reports/rollup.json')
      if (!rollup) continue
      for (const m of extractRollupPlayers(rollup)) {
        const key = lc(m.accountName)
        const prev = out.get(key)
        out.set(key, prev ? mergeMetrics(prev, m) : m)
      }
    }
    return out
  }
}

/** Pull a list of player rows out of a rollup.json, tolerant to schema drift. */
function extractRollupPlayers(rollup: unknown): BridgePlayerMetrics[] {
  const root = rollup as Record<string, unknown>
  const players =
    (Array.isArray(root.players) && root.players) ||
    (Array.isArray(root.accounts) && root.accounts) ||
    []
  const considered = num(root.runsConsidered ?? root.runs_considered ?? root.runs) ?? 0

  return (players as Record<string, unknown>[])
    .map((p): BridgePlayerMetrics | null => {
      const accountName = str(p.account ?? p.account_name ?? p.accountName ?? p.name)
      if (!accountName) return null
      const classSpread = asSpread(p.professions ?? p.classes ?? p.classSpread ?? p.class_spread)
      const mainClass =
        str(p.mainClass ?? p.main_class ?? p.profession) ?? topKey(classSpread) ?? null
      return {
        accountName,
        mainClass,
        classSpread,
        raidsAttended: num(p.runs ?? p.raidsAttended ?? p.attended) ?? 0,
        raidsConsidered: considered,
        combatTimeMs: num(p.combatTimeMs ?? p.combat_time_ms ?? p.combatTime) ?? 0,
        squadTimeMs: num(p.squadTimeMs ?? p.squad_time_ms ?? p.squadTime) ?? 0,
        lastSeen: str(p.lastSeen ?? p.last_seen ?? p.lastSeenAt) ?? null
      }
    })
    .filter((x): x is BridgePlayerMetrics => x !== null)
}

function mergeMetrics(a: BridgePlayerMetrics, b: BridgePlayerMetrics): BridgePlayerMetrics {
  const classSpread = { ...a.classSpread }
  for (const [k, v] of Object.entries(b.classSpread)) classSpread[k] = (classSpread[k] ?? 0) + v
  return {
    accountName: a.accountName,
    mainClass: topKey(classSpread) ?? a.mainClass ?? b.mainClass,
    classSpread,
    raidsAttended: a.raidsAttended + b.raidsAttended,
    raidsConsidered: a.raidsConsidered + b.raidsConsidered,
    combatTimeMs: a.combatTimeMs + b.combatTimeMs,
    squadTimeMs: a.squadTimeMs + b.squadTimeMs,
    lastSeen: maxIso(a.lastSeen, b.lastSeen)
  }
}

function asSpread(v: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const [k, n] of Object.entries(v as Record<string, unknown>)) {
      const c = num(n)
      if (c !== undefined) out[k] = c
    }
  } else if (Array.isArray(v)) {
    // ['Firebrand', 'Firebrand', 'Scrapper'] or [{profession, runs}]
    for (const item of v) {
      if (typeof item === 'string') out[item] = (out[item] ?? 0) + 1
      else if (item && typeof item === 'object') {
        const k = str((item as Record<string, unknown>).profession ?? (item as Record<string, unknown>).name)
        const c = num((item as Record<string, unknown>).runs ?? (item as Record<string, unknown>).count) ?? 1
        if (k) out[k] = (out[k] ?? 0) + c
      }
    }
  }
  return out
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

function num(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}
