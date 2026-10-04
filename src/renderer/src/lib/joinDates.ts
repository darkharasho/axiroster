// When a member joined: the in-game guild (GW2 API) and the Discord server
// (AxiTools). Both arrive as ISO timestamps and either may be missing.

/** "Mar 4, 2024", or null when the timestamp is absent or unparseable. */
export function fmtJoined(iso: string | null | undefined): string | null {
  const t = iso ? Date.parse(iso) : NaN
  if (Number.isNaN(t)) return null
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Both join dates on one line, e.g. "In-game Mar 4, 2024 · Discord Jan 12, 2023". */
export function joinedLine(m: { joined?: string | null; discordJoined?: string | null }): string {
  return `In-game ${fmtJoined(m.joined) ?? '—'} · Discord ${fmtJoined(m.discordJoined) ?? '—'}`
}
