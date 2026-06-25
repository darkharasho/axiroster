import { useEffect, useState } from 'react'
import { Users, Settings as SettingsIcon, ShieldCheck } from 'lucide-react'
import type { SyncStatus } from '../../preload/index.d'
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

  useEffect(() => {
    window.axiroster.syncStatus().then(setSync)
    const off = window.axiroster.onSyncStatus(setSync)
    return off
  }, [])

  const nav: { id: Section; label: string; icon: JSX.Element }[] = [
    { id: 'roster', label: 'Roster', icon: <Users size={18} /> },
    { id: 'settings', label: 'Settings', icon: <SettingsIcon size={18} /> }
  ]

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* rail */}
      <aside className="flex w-56 shrink-0 flex-col border-r border-panel-line bg-panel">
        <div className="flex items-center gap-2 px-4 py-4">
          <ShieldCheck size={20} className="text-accent" />
          <div className="text-sm font-semibold tracking-wide text-white">AxiRoster</div>
        </div>
        <nav className="flex flex-col gap-1 px-2">
          {nav.map((n) => (
            <button
              key={n.id}
              onClick={() => setSection(n.id)}
              className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition ${
                section === n.id
                  ? 'bg-panel-raised text-white'
                  : 'text-ink-dim hover:bg-panel-raised/60 hover:text-ink'
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
  )
}
