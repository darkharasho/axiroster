import { useCallback, useEffect, useState } from 'react'
import { Users, Settings as SettingsIcon, Plus } from 'lucide-react'
import type { GuildSummary, SyncStatus } from '../../preload/index.d'
import Titlebar from './components/Titlebar'
import RosterView from './components/RosterView'
import SettingsView from './components/SettingsView'

type Section = 'roster' | 'settings'

const SYNC_META: Record<SyncStatus, { color: string; label: string }> = {
  disabled: { color: '#78716c', label: 'Local only' },
  connecting: { color: '#f59e0b', label: 'Connecting…' },
  connected: { color: '#22c55e', label: 'Synced' },
  error: { color: '#ef4444', label: 'Sync error' }
}

export default function App(): JSX.Element {
  const [section, setSection] = useState<Section>('roster')
  const [sync, setSync] = useState<SyncStatus>('disabled')
  const [guilds, setGuilds] = useState<GuildSummary[]>([])

  const loadGuilds = useCallback(async () => {
    setGuilds(await window.axiroster.listGuilds())
  }, [])

  useEffect(() => {
    window.axiroster.syncStatus().then(setSync)
    const off = window.axiroster.onSyncStatus(setSync)
    return off
  }, [])

  // Refresh the guild list on mount and whenever we land back on the roster
  // (covers guilds added/removed/renamed over in Settings).
  useEffect(() => {
    loadGuilds()
  }, [loadGuilds, section])

  // A member adopting a shared/workspace guild fires workspace:changed — pick up
  // the new guild in the switcher without needing to navigate.
  useEffect(() => {
    return window.axiroster.onWorkspaceChanged(() => void loadGuilds())
  }, [loadGuilds])

  const swapGuild = async (id: string): Promise<void> => {
    await window.axiroster.setActiveGuild(id)
    await loadGuilds()
  }

  const nav: { id: Section; label: string; icon: JSX.Element }[] = [
    { id: 'roster', label: 'Roster', icon: <Users size={18} /> },
    { id: 'settings', label: 'Settings', icon: <SettingsIcon size={18} /> }
  ]

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-[10px] border border-panel-line bg-panel [clip-path:inset(0_round_10px)]">
      <Titlebar />
      <div className="flex min-h-0 flex-1">
        {/* rail */}
        <aside className="flex w-56 shrink-0 flex-col border-r border-panel-line bg-panel-sunk">
          {/* guild switcher */}
          <div className="px-3 pb-2 pt-3">
            <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
              Guilds
            </div>
            <div className="space-y-0.5">
              {guilds.map((g) => (
                <button
                  key={g.id}
                  onClick={() => swapGuild(g.id)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition ${
                    g.active
                      ? 'bg-accent/12 text-white'
                      : 'text-ink-dim hover:bg-panel-hover hover:text-ink'
                  }`}
                  title={`${g.gw2GuildName || 'no GW2 guild'} · ${g.discordGuildName || 'no Discord'}`}
                >
                  <span
                    className="led shrink-0"
                    style={{ background: g.active ? '#22c55e' : '#57534e' }}
                  />
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md border border-panel-line2 bg-panel-raised text-[9px] font-bold text-ink-dim">
                    {g.name.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{g.name}</span>
                </button>
              ))}
              <button
                onClick={() => setSection('settings')}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-ink-faint transition hover:bg-panel-hover hover:text-ink"
              >
                <Plus size={13} className="ml-0.5 shrink-0" />
                <span>{guilds.length === 0 ? 'Add a guild' : 'Manage guilds'}</span>
              </button>
            </div>
          </div>

          <div className="mx-3 my-1 border-t border-panel-line" />

          <nav className="flex flex-col gap-1 px-2">
            {nav.map((n) => (
              <button
                key={n.id}
                onClick={() => setSection(n.id)}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition ${
                  section === n.id
                    ? 'bg-accent/12 text-white'
                    : 'text-ink-dim hover:bg-panel-hover hover:text-ink'
                }`}
              >
                {n.icon}
                {n.label}
              </button>
            ))}
          </nav>

          <div className="mt-auto px-4 py-3">
            <div className="flex items-center gap-2 text-xs text-ink-dim">
              <span className="led" style={{ background: SYNC_META[sync].color }} />
              {SYNC_META[sync].label}
            </div>
          </div>
        </aside>

        {/* main */}
        <main className="flex min-w-0 flex-1 flex-col">
          {section === 'roster' ? <RosterView /> : <SettingsView />}
        </main>
      </div>
    </div>
  )
}
