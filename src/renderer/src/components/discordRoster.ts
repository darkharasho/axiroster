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

// An avatar used to be tinted from a seven-colour palette. Seven arbitrary inks
// is exactly what RULES.md rule 10 rules out — they compete with the five that
// already mean something and none of them says anything about the member — so
// the avatar is now a neutral outlined tile carrying the initials, and identity
// is read from the name next to it.
