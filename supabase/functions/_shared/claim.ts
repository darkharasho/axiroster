// supabase/functions/_shared/claim.ts
export function decideClaim(
  existingOwnerCount: number,
  isLeader: boolean
): { ok: boolean; reason?: 'not_leader' | 'already_claimed' } {
  if (existingOwnerCount > 0) return { ok: false, reason: 'already_claimed' }
  if (!isLeader) return { ok: false, reason: 'not_leader' }
  return { ok: true }
}
