import { useEffect, useState } from 'react'
import { RefreshCw, UserX } from 'lucide-react'
import type { WorkspaceMember } from '../../../preload/index.d'
import { RoleToggle, type ToggleRole } from './RoleToggle'
import { useDiscordRoster, avatarColor } from './discordRoster'

export function MemberAccessPanel(): JSX.Element {
  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const { infoFor } = useDiscordRoster()

  const load = async (): Promise<void> => {
    setLoading(true)
    try {
      const list = await window.axiroster.listMembers()
      setMembers(list)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const handleRoleChange = async (userId: string, role: ToggleRole): Promise<void> => {
    setBusy(userId)
    try {
      await window.axiroster.setMemberRole(userId, role)
      await load()
    } finally {
      setBusy(null)
    }
  }

  const handleRevoke = async (userId: string): Promise<void> => {
    if (!confirm('Revoke access for this member?')) return
    setBusy(userId)
    try {
      await window.axiroster.revokeMember(userId)
      await load()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wide text-ink-faint">Members</div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="btn px-2 text-ink-faint"
          title="Refresh"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {loading && members.length === 0 ? (
        <div className="text-xs text-ink-faint">Loading members…</div>
      ) : members.length === 0 ? (
        <div className="text-xs text-ink-faint">No members yet.</div>
      ) : (
        <div className="space-y-1">
          {members.map((m) => {
            const isOwner = m.role === 'owner'
            const isBusy = busy === m.userId
            const info = m.discordId ? infoFor(m.discordId) : null
            const label = info?.displayName || info?.name || m.discordId || m.userId
            // Show the actual @username as subtext (fall back to the raw id).
            const sub = info?.name ? `@${info.name}` : m.discordId
            const initial = label.charAt(0).toUpperCase() || '?'
            return (
              <div
                key={m.userId}
                className={`flex items-center gap-2.5 rounded-md border border-panel-line bg-panel px-3 py-2 ${
                  isOwner ? 'opacity-80' : ''
                }`}
              >
                <span
                  className="flex h-7 w-7 flex-none items-center justify-center rounded-full text-xs font-bold text-black"
                  style={{ background: isOwner ? '#10b981' : avatarColor(m.discordId || m.userId) }}
                >
                  {initial}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-ink">{label}</div>
                  {sub && sub !== label && (
                    <div className="truncate text-[11px] text-ink-faint">{sub}</div>
                  )}
                </div>
                {isOwner ? (
                  <span className="chip px-1.5 py-0 text-emerald-400">owner</span>
                ) : (
                  <>
                    <RoleToggle
                      value={(m.role as ToggleRole) === 'write' ? 'write' : 'read'}
                      disabled={isBusy}
                      onChange={(role) => void handleRoleChange(m.userId, role)}
                    />
                    <button
                      onClick={() => void handleRevoke(m.userId)}
                      disabled={isBusy}
                      className="btn px-2 text-ink-faint hover:text-red-400"
                      title="Revoke access"
                    >
                      {isBusy ? (
                        <RefreshCw size={12} className="animate-spin" />
                      ) : (
                        <UserX size={12} />
                      )}
                    </button>
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
