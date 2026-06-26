// The trustworthy source of a user's Discord id is the OAuth identity record
// (auth.identities), which Supabase Auth populates on sign-in and the user
// CANNOT edit. `user_metadata` (raw_user_meta_data) IS user-editable via
// auth.updateUser, so reading provider_id from there would let a user spoof
// someone else's Discord id and redeem their invite. Always derive it here.

export interface UserIdentityLike {
  provider?: string
  id?: string
  identity_data?: Record<string, unknown> | null
}
export interface UserLike {
  identities?: UserIdentityLike[] | null
}

/** Returns the Discord account id from the user's linked Discord identity, or
 *  null if they have no Discord identity. Never reads user_metadata. */
export function discordIdFromUser(user: UserLike): string | null {
  const identity = user.identities?.find((i) => i.provider === 'discord')
  if (!identity) return null
  const data = identity.identity_data ?? {}
  return (
    (typeof data.provider_id === 'string' ? data.provider_id : null) ??
    (typeof data.sub === 'string' ? data.sub : null) ??
    identity.id ??
    null
  )
}

const str = (v: unknown): string | null => {
  if (typeof v !== 'string' || !v.trim()) return null
  // Strip the legacy Discord discriminator (e.g. "harasho#0" -> "harasho").
  // Post-migration accounts all carry "#0"; old ones carry "#1234".
  return v.replace(/#\d{1,4}$/, '')
}

/** Returns the Discord @username and display (global) name from the linked
 *  Discord identity. Also derived from auth.identities, not user_metadata. */
export function discordNamesFromUser(user: UserLike): {
  username: string | null
  globalName: string | null
} {
  const identity = user.identities?.find((i) => i.provider === 'discord')
  const data = (identity?.identity_data ?? {}) as Record<string, unknown>
  const custom = (data.custom_claims ?? {}) as Record<string, unknown>
  // Discord's unique @handle (e.g. "harasho").
  const username =
    str(data.user_name) ?? str(data.preferred_username) ?? str(data.name) ?? null
  // Discord's chosen display name ("global name"), falling back to the handle.
  const globalName =
    str(custom.global_name) ?? str(data.full_name) ?? str(data.name) ?? username
  return { username, globalName }
}
