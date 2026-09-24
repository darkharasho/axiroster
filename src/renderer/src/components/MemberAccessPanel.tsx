import { useEffect, useState } from 'react'
import { RefreshCw, UserX } from 'lucide-react'
import type { WorkspaceMember } from '../../../preload/index.d'
import { client } from '../lib/client'
import { RoleToggle, type ToggleRole } from './RoleToggle'
import { useDiscordRoster } from './discordRoster'
import Tooltip from './Tooltip'

export function MemberAccessPanel(): JSX.Element {
  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const { infoFor } = useDiscordRoster()

  const load = async (): Promise<void> => {
    setLoading(true)
    try {
      const list = await client.listMembers()
      setMembers(list)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // Live refresh when membership changes (accept / revoke / role change).
    return client.onWorkspaceChanged(() => void load())
  }, [])

  const handleRoleChange = async (userId: string, role: ToggleRole): Promise<void> => {
    setBusy(userId)
    try {
      await client.setMemberRole(userId, role)
      await load()
    } finally {
      setBusy(null)
    }
  }

  const handleRevoke = async (userId: string): Promise<void> => {
    if (!confirm('Revoke access for this member?')) return
    setBusy(userId)
    try {
      await client.revokeMember(userId)
      await load()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="ar-field gap-3">
      <div className="ar-section__head" style={{ margin: 0 }}>
        <div className="axi-eyebrow">Members</div>
        <Tooltip text="Refresh">
          <button onClick={() => void load()} disabled={loading} className="ar-icon-btn">
            <RefreshCw size={12} className={loading ? 'ar-work' : ''} />
          </button>
        </Tooltip>
      </div>

      {loading && members.length === 0 ? (
        <div className="ar-note--faint">Loading members…</div>
      ) : members.length === 0 ? (
        <div className="ar-note--faint">No members yet.</div>
      ) : (
        <div className="flex flex-col gap-2">
          {members.map((m) => {
            const isOwner = m.role === 'owner'
            const isBusy = busy === m.userId
            const info = m.discordId ? infoFor(m.discordId) : null
            // Prefer the name persisted on the membership row; fall back to the
            // live AxiTools roster, then to the raw id as a last resort.
            const label =
              m.discordGlobalName ||
              m.discordName ||
              info?.displayName ||
              info?.name ||
              m.discordId ||
              m.userId
            const handle = m.discordName || info?.name
            const sub = handle ? `@${handle}` : m.discordId
            const initial = label.charAt(0).toUpperCase() || '?'
            return (
              <div key={m.userId} className="ar-tile items-center">
                {/* A neutral outlined tile with the initial: identity is read
                    from the name beside it, not from a tint. */}
                <span className="ar-guild__tile">{initial}</span>
                <div className="min-w-0 flex-1">
                  <div className="ar-row__name">{label}</div>
                  {sub && sub !== label && <div className="ar-row__sub">{sub}</div>}
                </div>
                {isOwner ? (
                  <span className="axi-chip axi-chip--ok">owner</span>
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
                      className="ar-icon-btn ar-icon-btn--danger"
                      title="Revoke access"
                    >
                      {isBusy ? (
                        <RefreshCw size={12} className="ar-work" />
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
