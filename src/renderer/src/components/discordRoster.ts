import { useEffect, useState } from 'react'
import type { DiscordRosterMember } from '../../../preload/index.d'
import { client } from '../lib/client'

/** Loads the active guild's Discord roster once; resolves a raw id -> member. */
export function useDiscordRoster(): {
  members: DiscordRosterMember[]
  infoFor: (id: string) => DiscordRosterMember | null
} {
  const [members, setMembers] = useState<DiscordRosterMember[]>([])
  useEffect(() => {
    void client
      .discordMembers()
      .then(setMembers)
      .catch(() => setMembers([]))
  }, [])
  const infoFor = (id: string): DiscordRosterMember | null =>
    members.find((x) => x.id === id) ?? null
  return { members, infoFor }
}

const AVATAR_PALETTE = ['#5865f2', '#3ba55d', '#faa61a', '#eb459e', '#9b59b6', '#1abc9c', '#e67e22']

/** Deterministic avatar color from a seed (id/name). */
export function avatarColor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length]
}
