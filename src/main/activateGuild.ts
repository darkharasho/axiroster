// The body of guilds:setActive. The renderer remounts every guild view once
// this resolves, so the views refetch on their own; the only event left to
// send is workspace:changed, for the listeners that outlive a switch (the
// guild list, invites, auth). A sync:changed here would make every freshly
// mounted view load twice.
export async function activateGuild(
  id: string,
  deps: { setActive: (id: string) => void; initSync: () => Promise<void>; notify: (channel: 'workspace:changed') => void }
): Promise<void> {
  deps.setActive(id)
  await deps.initSync()
  deps.notify('workspace:changed')
}
