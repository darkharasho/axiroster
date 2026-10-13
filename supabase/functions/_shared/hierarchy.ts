// supabase/functions/_shared/hierarchy.ts
// Discord role-hierarchy guard for AxiTools management actions. The bot runs
// every action as itself, so Discord only checks the BOT's top role; this
// re-applies Discord's rules for the signed-in person instead: you can only
// touch roles below your own top role, and only act on members whose top role
// is below yours. The server owner bypasses it. Pure; Deno + Node.

export interface HierarchyOverview {
  guild?: { owner_id?: string | null } | null
  roles?: { id: string; position: number }[]
  members?: { id: string; role_ids?: string[] }[]
}

export interface HierarchyDenial {
  error: 'hierarchy_denied' | 'not_in_guild'
  message: string
}

/** Actions whose role_id must sit below the actor's top role. */
const ROLE_TARGET = new Set(['role_assign', 'role_unassign', 'role_update', 'role_delete'])
/** Actions whose member_id must rank below the actor (unless it is the actor). */
const MEMBER_TARGET = new Set([
  'role_assign',
  'role_unassign',
  'member_kick',
  'member_ban',
  'member_timeout',
  'member_nick'
])

export function needsHierarchyCheck(action: string): boolean {
  return ROLE_TARGET.has(action) || MEMBER_TARGET.has(action)
}

const deny = (message: string): HierarchyDenial => ({ error: 'hierarchy_denied', message })

/** Null when the actor may perform the action, else why not. Unknown roles or
 *  members fail closed. */
export function checkHierarchy(
  overview: HierarchyOverview,
  actorDiscordId: string | null,
  action: string,
  params: Record<string, unknown>
): HierarchyDenial | null {
  if (!needsHierarchyCheck(action)) return null
  const ownerId = overview.guild?.owner_id ?? null
  if (actorDiscordId && ownerId && actorDiscordId === ownerId) return null

  const positions = new Map((overview.roles ?? []).map((r) => [r.id, r.position]))
  const members = new Map((overview.members ?? []).map((m) => [m.id, m]))
  const topOf = (id: string): number =>
    Math.max(0, ...(members.get(id)?.role_ids ?? []).map((r) => positions.get(r) ?? 0))

  if (!actorDiscordId || !members.has(actorDiscordId)) {
    return {
      error: 'not_in_guild',
      message: 'Your Discord account was not found in this server, so this action is not allowed.'
    }
  }
  const actorTop = topOf(actorDiscordId)

  if (ROLE_TARGET.has(action)) {
    const pos = positions.get(String(params.role_id ?? ''))
    if (pos === undefined) return deny('That role was not found in this server.')
    if (pos >= actorTop) return deny('You can only manage roles below your own highest Discord role.')
  }

  if (MEMBER_TARGET.has(action)) {
    const target = String(params.member_id ?? '')
    if (target !== actorDiscordId) {
      if (!members.has(target)) return deny('That member was not found in this server.')
      if (target === ownerId) return deny('You cannot act on the server owner.')
      if (topOf(target) >= actorTop) {
        return deny('You can only act on members whose highest Discord role is below yours.')
      }
    }
  }
  return null
}
