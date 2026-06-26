import { useCallback, useEffect, useState } from 'react'
import { Users, Share2, Settings as SettingsIcon, Plus, Cog, Loader2, ScrollText, Mail } from 'lucide-react'
import type { GuildSummary, SyncStatus, PendingInvite } from '../../preload/index.d'
import Titlebar from './components/Titlebar'
import RosterView from './components/RosterView'
import GuildSharing from './components/GuildSharing'
import GuildLog from './components/GuildLog'
import GuildSettings, { GuildEditor } from './components/GuildSettings'
import AppSettings from './components/AppSettings'
import InvitePlaceholder from './components/InvitePlaceholder'
import WhatsNewModal from './components/WhatsNewModal'
import Toasts from './components/Toasts'

type Tab = 'roster' | 'log' | 'sharing' | 'settings'
type View = 'guild' | 'add-guild' | 'invite'

const SYNC_META: Record<SyncStatus, { color: string; label: string }> = {
  disabled: { color: '#78716c', label: 'Local only' },
  connecting: { color: '#f59e0b', label: 'Connecting…' },
  connected: { color: '#22c55e', label: 'Synced' },
  error: { color: '#ef4444', label: 'Sync error' }
}

type Role = 'owner' | 'write' | 'read'
const ROLE_BADGE: Record<Role, string> = {
  owner: 'bg-emerald-500/14 text-emerald-400',
  write: 'bg-accent/16 text-accent',
  read: 'bg-stone-500/18 text-ink-dim'
}

const TABS: { id: Tab; label: string; icon: JSX.Element }[] = [
  { id: 'roster', label: 'Roster', icon: <Users size={15} /> },
  { id: 'log', label: 'Log', icon: <ScrollText size={15} /> },
  { id: 'sharing', label: 'Sharing', icon: <Share2 size={15} /> },
  { id: 'settings', label: 'Settings', icon: <SettingsIcon size={15} /> }
]

export default function App(): JSX.Element {
  const [sync, setSync] = useState<SyncStatus>('disabled')
  const [guilds, setGuilds] = useState<GuildSummary[]>([])
  const [roles, setRoles] = useState<Record<string, string>>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [invites, setInvites] = useState<PendingInvite[]>([])
  const [selectedInviteId, setSelectedInviteId] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('roster')
  const [view, setView] = useState<View>('guild')
  // Bumped to force the roster back out of a member detail to the list.
  const [rosterReset, setRosterReset] = useState(0)
  const [appSettingsOpen, setAppSettingsOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [whatsNew, setWhatsNew] = useState<{ version: string; notes: string | null } | null>(null)

  const loadGuilds = useCallback(async () => {
    const [list, roleMap] = await Promise.all([
      window.axiroster.listGuilds(),
      window.axiroster.listWorkspaceRoles()
    ])
    setGuilds(list)
    setRoles(roleMap)
    setLoaded(true)
    // Default selection follows the active guild.
    setSelectedId((cur) => {
      if (cur && list.some((g) => g.id === cur)) return cur
      return list.find((g) => g.active)?.id ?? list[0]?.id ?? null
    })
  }, [])

  // Invites pushed to this Discord account. A not-yet-member can't subscribe via
  // realtime (RLS), so poll — and also refresh on workspace changes.
  const loadInvites = useCallback(async () => {
    try {
      setInvites(await window.axiroster.listInvites())
    } catch {
      setInvites([])
    }
  }, [])

  useEffect(() => {
    void loadInvites()
    const id = setInterval(() => void loadInvites(), 8000)
    const off = window.axiroster.onWorkspaceChanged(() => void loadInvites())
    return () => {
      clearInterval(id)
      off()
    }
  }, [loadInvites])

  useEffect(() => {
    window.axiroster.syncStatus().then(setSync)
    return window.axiroster.onSyncStatus(setSync)
  }, [])

  // Auto-show release notes once after an update (version moved past lastSeen).
  useEffect(() => {
    void window.axiroster.getWhatsNew().then((w) => {
      if (w.releaseNotes && w.version !== w.lastSeenVersion) {
        setWhatsNew({ version: w.version, notes: w.releaseNotes })
      }
    })
  }, [])

  const closeWhatsNew = useCallback(() => {
    if (whatsNew) void window.axiroster.markWhatsNewSeen(whatsNew.version)
    setWhatsNew(null)
  }, [whatsNew])

  // Manual reopen from the cog — force shows the current version's notes.
  const openWhatsNew = useCallback(async () => {
    setAppSettingsOpen(false)
    const w = await window.axiroster.getWhatsNew(true)
    setWhatsNew({ version: w.version, notes: w.releaseNotes })
  }, [])

  useEffect(() => {
    void loadGuilds()
  }, [loadGuilds])

  // Adopting a shared guild / membership or role changes fire workspace:changed.
  useEffect(() => {
    return window.axiroster.onWorkspaceChanged(() => void loadGuilds())
  }, [loadGuilds])

  // Selecting a guild makes it active (roster + sync follow) and lands on Roster.
  const selectGuild = async (id: string): Promise<void> => {
    setSelectedId(id)
    setSelectedInviteId(null)
    setView('guild')
    setTab('roster')
    // Re-clicking the active guild, or switching guilds, drops out of any open
    // member detail back to the (new) guild's roster list.
    setRosterReset((n) => n + 1)
    await window.axiroster.setActiveGuild(id)
    await loadGuilds()
  }

  // A placeholder "invited" guild — show its accept/reject view.
  const selectInvite = (id: string): void => {
    setSelectedInviteId(id)
    setSelectedId(null)
    setView('invite')
  }

  const respondInvite = async (
    invite: PendingInvite,
    action: 'accept' | 'reject'
  ): Promise<void> => {
    await window.axiroster.respondInvite(invite.id, action)
    setSelectedInviteId(null)
    setSelectedId(null) // let loadGuilds land on the active guild (the new one on accept)
    setView('guild')
    await Promise.all([loadGuilds(), loadInvites()])
  }

  const selected = guilds.find((g) => g.id === selectedId) ?? null
  const selectedInvite = invites.find((i) => i.id === selectedInviteId) ?? null

  const badgeFor = (g: GuildSummary): { cls: string; label: string } => {
    const role = roles[g.gw2GuildId] as Role | undefined
    if (role) return { cls: ROLE_BADGE[role], label: role }
    if (g.shared) return { cls: 'bg-accent/16 text-accent', label: 'shared' }
    return { cls: 'bg-stone-500/18 text-ink-faint', label: 'local' }
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-[10px] border border-panel-line bg-panel [clip-path:inset(0_round_10px)]">
      <Titlebar />
      <div className="relative flex min-h-0 flex-1">
        {/* rail */}
        <aside className="flex w-60 shrink-0 flex-col border-r border-panel-line bg-panel-sunk">
          <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-3">
            <div className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
              Guilds
            </div>

            <div className="space-y-0.5">
              {!loaded && guilds.length === 0 && (
                <div className="space-y-1.5 px-1 py-1">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="flex items-center gap-2.5 px-1 py-1">
                      <span className="h-6 w-6 shrink-0 animate-pulse rounded-md bg-panel-raised" />
                      <span className="h-3 flex-1 animate-pulse rounded bg-panel-raised" />
                    </div>
                  ))}
                </div>
              )}
              {guilds.map((g) => {
                const isSel = g.id === selectedId && view === 'guild'
                const badge = badgeFor(g)
                return (
                  <div key={g.id}>
                    <button
                      onClick={() => void selectGuild(g.id)}
                      className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition ${
                        isSel ? 'bg-accent/10' : 'hover:bg-panel-hover'
                      }`}
                    >
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-panel-line2 bg-panel-raised text-[9px] font-bold text-ink-dim">
                        {(g.name || '??').slice(0, 2).toUpperCase()}
                      </span>
                      <span
                        className={`min-w-0 flex-1 truncate text-[13px] ${
                          isSel ? 'font-semibold text-white' : 'font-medium text-ink-dim'
                        }`}
                      >
                        {g.name}
                      </span>
                      {g.active && (
                        <span
                          className="led shrink-0"
                          style={{ background: SYNC_META[sync].color }}
                          title={SYNC_META[sync].label}
                        />
                      )}
                      <span
                        className={`shrink-0 rounded-full px-1.5 py-px text-[9px] font-bold uppercase tracking-wide ${badge.cls}`}
                      >
                        {badge.label}
                      </span>
                    </button>

                    {/* nested sub-items for the selected guild */}
                    {g.id === selectedId && view === 'guild' && (
                      <div className="ml-[18px] mt-0.5 mb-1.5 flex flex-col gap-px border-l border-panel-line2 pl-3">
                        {TABS.map((t) => (
                          <button
                            key={t.id}
                            onClick={() => {
                              setTab(t.id)
                              // Clicking Roster returns from a member detail to the list.
                              if (t.id === 'roster') setRosterReset((n) => n + 1)
                            }}
                            className={`flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition ${
                              tab === t.id
                                ? 'bg-accent/14 font-medium text-white'
                                : 'text-ink-dim hover:bg-panel-hover hover:text-ink'
                            }`}
                          >
                            <span className="opacity-85">{t.icon}</span>
                            {t.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}

              {/* Pending invites appear as placeholder "invited" guilds. */}
              {invites.map((inv) => {
                const isSel = view === 'invite' && inv.id === selectedInviteId
                return (
                  <button
                    key={inv.id}
                    onClick={() => selectInvite(inv.id)}
                    className={`flex w-full items-center gap-2.5 rounded-lg border border-dashed px-2 py-1.5 text-left transition ${
                      isSel
                        ? 'border-accent/40 bg-accent/10'
                        : 'border-panel-line2 hover:bg-panel-hover'
                    }`}
                  >
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-dashed border-panel-line2 text-ink-faint">
                      <Mail size={13} />
                    </span>
                    <span
                      className={`min-w-0 flex-1 truncate text-[13px] ${
                        isSel ? 'font-semibold text-white' : 'font-medium text-ink-dim'
                      }`}
                    >
                      {inv.guildName}
                    </span>
                    <span className="shrink-0 rounded-full bg-amber-500/16 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-amber-400">
                      invited
                    </span>
                  </button>
                )
              })}

              <button
                onClick={() => {
                  setView('add-guild')
                  setSelectedId(null)
                  setSelectedInviteId(null)
                }}
                className={`mt-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition ${
                  view === 'add-guild'
                    ? 'bg-accent/10 text-white'
                    : 'text-ink-faint hover:bg-panel-hover hover:text-ink'
                }`}
              >
                <Plus size={14} className="shrink-0" />
                Add a guild
              </button>
            </div>
          </div>

          {/* footer: connection status + app-settings cog */}
          <div className="flex items-center justify-between border-t border-panel-line px-3 py-2.5">
            <div className="flex items-center gap-2 text-xs text-ink-dim">
              <span className="led" style={{ background: SYNC_META[sync].color }} />
              {SYNC_META[sync].label}
            </div>
            <button
              onClick={() => setAppSettingsOpen(true)}
              className="grid h-7 w-7 place-items-center rounded-md border border-transparent text-ink-faint transition hover:border-panel-line2 hover:bg-panel-hover hover:text-ink"
              title="App settings"
            >
              <Cog size={15} />
            </button>
          </div>
        </aside>

        {/* main */}
        <main className="flex min-w-0 flex-1 flex-col">
          {view === 'add-guild' ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="mx-auto max-w-3xl space-y-6 px-8 py-8">
                <h1 className="text-lg font-semibold text-white">Add a guild</h1>
                <GuildEditor
                  initial={null}
                  onDone={async () => {
                    const list = await window.axiroster.listGuilds()
                    setGuilds(list)
                    const fresh = list.find((g) => g.active) ?? list[list.length - 1]
                    if (fresh) await selectGuild(fresh.id)
                    else setView('guild')
                  }}
                  onCancel={() => setView('guild')}
                />
              </div>
            </div>
          ) : view === 'invite' && selectedInvite ? (
            <InvitePlaceholder invite={selectedInvite} onRespond={respondInvite} />
          ) : !loaded ? (
            <div className="grid flex-1 place-items-center px-8 text-ink-faint">
              <Loader2 size={20} className="animate-spin" />
            </div>
          ) : !selected ? (
            <div className="grid flex-1 place-items-center px-8 text-center text-sm text-ink-faint">
              No guilds yet. Click <span className="mx-1 text-ink">Add a guild</span> to connect one.
            </div>
          ) : tab === 'roster' ? (
            <RosterView resetToken={rosterReset} />
          ) : tab === 'log' ? (
            <GuildLog />
          ) : tab === 'sharing' ? (
            <GuildSharing guild={selected} onOpenAppSettings={() => setAppSettingsOpen(true)} />
          ) : (
            <GuildSettings
              guild={selected}
              onChanged={loadGuilds}
              onRemoved={async () => {
                setView('guild')
                setSelectedId(null)
                await loadGuilds()
              }}
            />
          )}
        </main>

        {appSettingsOpen && (
          <AppSettings
            onClose={() => {
              setAppSettingsOpen(false)
              void loadGuilds()
            }}
            onShowWhatsNew={openWhatsNew}
          />
        )}

        {whatsNew && (
          <WhatsNewModal version={whatsNew.version} releaseNotes={whatsNew.notes} onClose={closeWhatsNew} />
        )}

        <Toasts />
      </div>
    </div>
  )
}
