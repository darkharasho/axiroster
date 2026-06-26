import { useEffect, useState } from 'react'
import { RefreshCw, UserX } from 'lucide-react'
import type { WorkspaceMember } from '../../../preload/index.d'

export function MemberAccessPanel(): JSX.Element {
  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

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

  const handleRoleChange = async (userId: string, role: string): Promise<void> => {
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
            return (
              <div
                key={m.userId}
                className={`flex items-center gap-2 rounded-md border border-panel-line bg-panel px-3 py-2 ${
                  isOwner ? 'opacity-60' : ''
                }`}
              >
                <span className="flex-1 truncate text-sm text-ink">
                  {m.discordId || m.userId}
                </span>
                {isOwner ? (
                  <span className="chip px-1.5 py-0 text-emerald-400">owner</span>
                ) : (
                  <>
                    <select
                      value={m.role}
                      disabled={isBusy}
                      onChange={(e) => void handleRoleChange(m.userId, e.target.value)}
                      className="field py-0.5 text-xs"
                    >
                      <option value="read">read</option>
                      <option value="write">write</option>
                    </select>
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
