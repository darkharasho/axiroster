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
