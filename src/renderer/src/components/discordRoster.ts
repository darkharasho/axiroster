import { useEffect, useState } from 'react'
import type { DiscordRosterMember } from '../../../preload/index.d'

/** Loads the active guild's Discord roster once; resolves a raw id -> username. */
export function useDiscordRoster(): {
  members: DiscordRosterMember[]
  nameFor: (id: string) => string | null
} {
  const [members, setMembers] = useState<DiscordRosterMember[]>([])
  useEffect(() => {
    void window.axiroster
      .discordMembers()
      .then(setMembers)
      .catch(() => setMembers([]))
  }, [])
  const nameFor = (id: string): string | null => {
    const m = members.find((x) => x.id === id)
    return m ? m.displayName || m.name : null
  }
  return { members, nameFor }
}

const AVATAR_PALETTE = ['#5865f2', '#3ba55d', '#faa61a', '#eb459e', '#9b59b6', '#1abc9c', '#e67e22']

/** Deterministic avatar color from a seed (id/name). */
export function avatarColor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length]
}
