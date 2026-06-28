// src/main/roster/adapters.ts
// Pure parsers from raw AxiTools bot responses into the shapes reconcileRoster
// consumes. Platform-agnostic (no Electron/Node imports) so the web client can
// reuse them on the same raw JSON the Phase-1 axitools Edge Function returns.
// Moved verbatim from src/main/index.ts.
import type { LinkedMemberRaw, DiscordMemberRaw } from '../rosterReconcile'

export function asLinkedMembers(raw: unknown): LinkedMemberRaw[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((m): m is Record<string, unknown> => Boolean(m) && typeof m === 'object')
    .map((m) => ({
      member_id: String(m.member_id ?? ''),
      member_name: typeof m.member_name === 'string' ? m.member_name : undefined,
      accounts: Array.isArray(m.accounts)
        ? (m.accounts as Record<string, unknown>[]).map((a) => ({
            account_name: typeof a.account_name === 'string' ? a.account_name : undefined,
            characters: Array.isArray(a.characters) ? (a.characters as string[]) : undefined,
            guild_labels:
              a.guild_labels && typeof a.guild_labels === 'object'
                ? (a.guild_labels as Record<string, string>)
                : undefined
          }))
        : []
    }))
    .filter((m) => m.member_id)
}

// Raw role fields straight from the overview. Color/icon *presentation* (hex,
// black-as-default, CDN url) is done in the renderer (src/lib/roleStyle) so it
// hot-reloads — keep this a pass-through.
export interface DiscordRole {
  id: string
  name: string
  /** Raw Discord color: an int, a hex string, or null. */
  colorRaw: number | string | null
  /** Custom role icon hash (turned into a CDN url renderer-side), or null. */
  iconHash: string | null
  /** Role's unicode emoji, or null. */
  emoji: string | null
}

export function asDiscordRoles(overview: unknown): DiscordRole[] {
  const root = overview as Record<string, unknown> | null
  const roles = root && Array.isArray(root.roles) ? root.roles : []
  return (roles as Record<string, unknown>[])
    .filter((r) => r && typeof r === 'object' && r.id !== undefined)
    .map((r) => {
      const raw = r.color ?? r.colour
      return {
        id: String(r.id),
        name: typeof r.name === 'string' ? r.name : String(r.id),
        colorRaw: typeof raw === 'number' || typeof raw === 'string' ? raw : null,
        iconHash: typeof r.icon === 'string' && r.icon ? r.icon : null,
        emoji: typeof r.unicode_emoji === 'string' && r.unicode_emoji ? r.unicode_emoji : null
      }
    })
}

// AxiTools maps each Discord server to its GW2 guild(s) via the guild-roles
// config (gw2 guild id -> member role id). Pull the bound GW2 guild ids so the
// app can keep the GW2 guild and Discord server as one 1:1 connection.
export function parseBoundGw2Guilds(raw: unknown): string[] {
  const ids = new Set<string>()
  const looksGw2 = (s: string): boolean => /^[0-9A-F]{8}-/i.test(s)
  if (Array.isArray(raw)) {
    for (const r of raw) {
      if (r && typeof r === 'object') {
        const v = (r as Record<string, unknown>).gw2_guild_id ?? (r as Record<string, unknown>).guild_id
        if (typeof v === 'string') ids.add(v)
      } else if (typeof r === 'string' && looksGw2(r)) ids.add(r)
    }
  } else if (raw && typeof raw === 'object') {
    // map shape: { "<gw2GuildId>": "<roleId>", ... } or { roles: {...} }
    const obj = (raw as Record<string, unknown>).roles ?? (raw as Record<string, unknown>).guild_roles ?? raw
    if (obj && typeof obj === 'object') {
      for (const k of Object.keys(obj as Record<string, unknown>)) if (looksGw2(k)) ids.add(k)
    }
  }
  return [...ids]
}

export function asDiscordMembers(overview: unknown): DiscordMemberRaw[] {
  const root = overview as Record<string, unknown> | null
  const members = root && Array.isArray(root.members) ? root.members : []
  return (members as Record<string, unknown>[])
    .filter((m) => m && typeof m === 'object')
    .map((m) => ({
      id: String(m.id ?? ''),
      name: typeof m.name === 'string' ? m.name : undefined,
      display_name: typeof m.display_name === 'string' ? m.display_name : undefined,
      roles: parseRoleIds(m.roles ?? m.role_ids ?? m.roleIds),
      bot: isBot(m)
    }))
    .filter((m) => m.id)
}

/** Bots come back differently across bot builds — flag any of the known shapes. */
function isBot(m: Record<string, unknown>): boolean {
  const user = m.user as Record<string, unknown> | undefined
  return (
    m.bot === true ||
    m.is_bot === true ||
    m.isBot === true ||
    (user ? user.bot === true : false)
  )
}

/** Member roles come back as ['id', …] or [{id}, …] depending on the bot build. */
function parseRoleIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((r) =>
      typeof r === 'string' || typeof r === 'number'
        ? String(r)
        : r && typeof r === 'object' && (r as Record<string, unknown>).id !== undefined
          ? String((r as Record<string, unknown>).id)
          : ''
    )
    .filter(Boolean)
}
