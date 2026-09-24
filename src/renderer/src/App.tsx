import { useCallback, useEffect, useState } from 'react'
import { Users, Share2, Settings as SettingsIcon, Plus, Cog, Loader2, ScrollText, Mail, Activity, Users2, Crown, PencilLine, Eye } from 'lucide-react'
import type { GuildSummary, SyncStatus, PendingInvite } from '../../preload/index.d'
import { client } from './lib/client'
import Titlebar from './components/Titlebar'
import RosterView from './components/RosterView'
import GuildSharing from './components/GuildSharing'
import GuildLog from './components/GuildLog'
import GuildSettings, { GuildEditor } from './components/GuildSettings'
import RetentionView from './components/RetentionView'
import RecruitmentView from './components/RecruitmentView'
import AppSettings from './components/AppSettings'
import InvitePlaceholder from './components/InvitePlaceholder'
import WhatsNewModal from './components/WhatsNewModal'
import Toasts from './components/Toasts'
import WebJoinGuild from './components/WebJoinGuild'
import { isWeb } from './lib/runtime'
import { toneDiamond, type Tone } from './lib/status'
import Tooltip from './components/Tooltip'

type Tab = 'roster' | 'log' | 'sharing' | 'settings' | 'retention' | 'recruitment'
type View = 'guild' | 'add-guild' | 'invite'

// The sync light, named by what it asserts rather than by colour. "Local only"
// is the absence of a sync to judge, so it sits on the neutral ramp.
const SYNC_META: Record<SyncStatus, { tone: Tone; label: string }> = {
  disabled: { tone: 'idle', label: 'Local only' },
  connecting: { tone: 'warn', label: 'Connecting…' },
  connected: { tone: 'ok', label: 'Synced' },
  error: { tone: 'danger', label: 'Sync error' }
}

type Role = 'owner' | 'write' | 'read'
// What you may do in a workspace is neither a verdict on the guild nor a
// reading off it, so the chip takes no status ink: a filled chip here reads as
// a second selection competing with the one the rail already makes. The level
// still has to be scannable without reading, so each one carries a glyph for
// what it lets you do — look, write, own — which the eye recognises at chip
// scale where a word has to be spelled out. The word stays beside it; the icon
// is the shortcut, not the whole label.
const ROLE_ICON: Record<Role, JSX.Element> = {
  read: <Eye size={11} className="ar-role-icon" />,
  write: <PencilLine size={11} className="ar-role-icon" />,
  owner: <Crown size={11} className="ar-role-icon" />
}

const TABS: { id: Tab; label: string; icon: JSX.Element }[] = [
  { id: 'roster', label: 'Roster', icon: <Users size={15} /> },
  { id: 'log', label: 'Log', icon: <ScrollText size={15} /> },
  { id: 'retention', label: 'Retention', icon: <Activity size={15} /> },
  { id: 'recruitment', label: 'Recruitment', icon: <Users2 size={15} /> },
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
      client.listGuilds(),
      client.listWorkspaceRoles()
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
      setInvites(await client.listInvites())
    } catch {
      setInvites([])
    }
  }, [])

  useEffect(() => {
    void loadInvites()
    const id = setInterval(() => void loadInvites(), 8000)
    const off = client.onWorkspaceChanged(() => void loadInvites())
    return () => {
      clearInterval(id)
      off()
    }
  }, [loadInvites])

  useEffect(() => {
    client.syncStatus().then(setSync)
    return client.onSyncStatus(setSync)
  }, [])

  // Auto-show release notes once after an update (version moved past lastSeen).
  useEffect(() => {
    void client.getWhatsNew().then((w) => {
      if (w.releaseNotes && w.version !== w.lastSeenVersion) {
        setWhatsNew({ version: w.version, notes: w.releaseNotes })
      }
    })
  }, [])

  const closeWhatsNew = useCallback(() => {
    if (whatsNew) void client.markWhatsNewSeen(whatsNew.version)
    setWhatsNew(null)
  }, [whatsNew])

  // Manual reopen from the cog — force shows the current version's notes.
  const openWhatsNew = useCallback(async () => {
    setAppSettingsOpen(false)
    const w = await client.getWhatsNew(true)
    setWhatsNew({ version: w.version, notes: w.releaseNotes })
  }, [])

  useEffect(() => {
    void loadGuilds()
  }, [loadGuilds])

  // Adopting a shared guild / membership or role changes fire workspace:changed.
  useEffect(() => {
    return client.onWorkspaceChanged(() => void loadGuilds())
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
    await client.setActiveGuild(id)
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
    await client.respondInvite(invite.id, action)
    setSelectedInviteId(null)
    setSelectedId(null) // let loadGuilds land on the active guild (the new one on accept)
    setView('guild')
    await Promise.all([loadGuilds(), loadInvites()])
  }

  const selected = guilds.find((g) => g.id === selectedId) ?? null
  const selectedInvite = invites.find((i) => i.id === selectedInviteId) ?? null

  // Where a guild lives is not an access level, so "shared" and "local" get no
  // glyph — there is nothing they let you do for an icon to stand for.
  const badgeFor = (g: GuildSummary): { label: string; icon: JSX.Element | null } => {
    const role = roles[g.gw2GuildId] as Role | undefined
    if (role) return { label: role, icon: ROLE_ICON[role] }
    return { label: g.shared ? 'shared' : 'local', icon: null }
  }

  return (
    <div className="axi-window">
      <Titlebar />
      <div className="relative flex min-h-0 flex-1">
        {/* rail */}
        <aside className="ar-rail">
          <div className="ar-rail__head">
            <span className="axi-eyebrow">Guilds</span>
            <span className="ar-rail__count">{guilds.length}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            <div className="flex flex-col gap-1">
              {!loaded && guilds.length === 0 && (
                <div className="flex flex-col gap-2 p-1">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="flex items-center gap-2.5">
                      <span className="ar-skeleton h-6 w-6 shrink-0" />
                      <span className="ar-skeleton h-3 flex-1" />
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
                      className={`ar-guild${isSel ? ' ar-guild--on' : ''}`}
                    >
                      <span className="ar-guild__tile">
                        {(g.name || '??').slice(0, 2).toUpperCase()}
                      </span>
                      <span className="ar-guild__name">{g.name}</span>
                      {g.active && (
                        <span
                          className={`${toneDiamond(SYNC_META[sync].tone)}${
                            sync === 'connecting' ? ' ar-work' : ''
                          }`}
                          title={SYNC_META[sync].label}
                        />
                      )}
                      <span className="axi-chip" title={`${badge.label} access`}>
                        {badge.icon}
                        {badge.label}
                      </span>
                    </button>

                    {/* nested sub-items for the selected guild */}
                    {g.id === selectedId && view === 'guild' && (
                      <div className="ar-subtabs">
                        {TABS.filter((t) =>
                          (t.id !== 'retention' || selected?.retentionEnabled) &&
                          (t.id !== 'recruitment' || selected?.pipelineEnabled)
                        ).map((t) => (
                          <button
                            key={t.id}
                            onClick={() => {
                              setTab(t.id)
                              // Clicking Roster returns from a member detail to the list.
                              if (t.id === 'roster') setRosterReset((n) => n + 1)
                            }}
                            className={`ar-subtab${tab === t.id ? ' ar-subtab--on' : ''}`}
                          >
                            {t.icon}
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
                    className={`ar-guild ar-guild--invite${isSel ? ' ar-guild--on' : ''}`}
                  >
                    <span className="ar-guild__tile">
                      <Mail size={13} />
                    </span>
                    <span className="ar-guild__name">{inv.guildName}</span>
                    <span className="axi-chip axi-chip--warn">invited</span>
                  </button>
                )
              })}

              <button
                onClick={() => {
                  setView('add-guild')
                  setSelectedId(null)
                  setSelectedInviteId(null)
                }}
                className={`ar-rail__add${view === 'add-guild' ? ' ar-rail__add--on' : ''}`}
              >
                <Plus size={14} className="shrink-0" />
                Add a guild
              </button>
            </div>
          </div>

          {/* footer: connection status + app-settings cog */}
          <div className="ar-rail__foot">
            <span className="flex items-center gap-2">
              <span
                className={`${toneDiamond(SYNC_META[sync].tone)}${
                  sync === 'connecting' ? ' ar-work' : ''
                }`}
              />
              {SYNC_META[sync].label}
            </span>
            {!isWeb() && (
              <Tooltip text="App settings">
                <button onClick={() => setAppSettingsOpen(true)} className="ar-icon-btn">
                  <Cog size={15} />
                </button>
              </Tooltip>
            )}
          </div>
        </aside>

        {/* main */}
        <main className="ar-pane">
          {view === 'add-guild' ? (
            <div className="ar-pane__body">
              <div className="axi-page axi-page--narrow flex flex-col gap-5">
                <h1 className="ar-title">Add a guild</h1>
                <GuildEditor
                  initial={null}
                  onDone={async () => {
                    const list = await client.listGuilds()
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
            <div className="ar-note--faint grid flex-1 place-items-center px-8">
              <Loader2 size={20} className="ar-work" />
            </div>
          ) : !selected ? (
            isWeb() && guilds.length === 0 ? (
              <WebJoinGuild
                onJoined={(wsId) => {
                  if (wsId) void selectGuild(wsId)
                  else void loadGuilds()
                }}
              />
            ) : (
              <div className="ar-note--faint grid flex-1 place-items-center px-8 text-center">
                No guilds yet. Click{' '}
                <span className="mx-1 ar-ink">
                  Add a guild
                </span>{' '}
                to connect one.
              </div>
            )
          ) : tab === 'roster' ? (
            <RosterView resetToken={rosterReset} />
          ) : tab === 'log' ? (
            <GuildLog />
          ) : tab === 'sharing' ? (
            <GuildSharing guild={selected} onOpenAppSettings={() => setAppSettingsOpen(true)} />
          ) : tab === 'retention' && selected?.retentionEnabled ? (
            <RetentionView />
          ) : tab === 'retention' ? (
            <RosterView resetToken={rosterReset} />
          ) : tab === 'recruitment' && selected?.pipelineEnabled ? (
            <RecruitmentView />
          ) : tab === 'recruitment' ? (
            <RosterView resetToken={rosterReset} />
          ) : (
            <GuildSettings
              guild={selected}
              role={roles[selected.id]}
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
