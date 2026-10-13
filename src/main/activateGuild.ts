// The body of guilds:setActive. The renderer remounts every guild view once
// this resolves, so the views refetch on their own. initSync sends
// workspace:changed itself (for the listeners that outlive a switch: the guild
// list, invites, auth), so nothing is sent here; in particular no sync:changed,
// which would make every freshly mounted view load twice.
export async function activateGuild(
  id: string,
  deps: { setActive: (id: string) => void; initSync: () => Promise<void> }
): Promise<void> {
  deps.setActive(id)
  await deps.initSync()
}
