import { useEffect, useState } from 'react'
import { Check, X, RefreshCw, Ticket } from 'lucide-react'
import type { PendingInvite } from '../../../preload/index.d'

/** The invitee's view: invites pushed to their Discord account, to accept or reject. */
export function PendingInvites({ onChange }: { onChange?: () => void }): JSX.Element | null {
  const [invites, setInvites] = useState<PendingInvite[]>([])
  const [busy, setBusy] = useState<string | null>(null)

  const load = (): void => {
    void window.axiroster
      .listInvites()
      .then(setInvites)
      .catch(() => setInvites([]))
  }
  useEffect(() => {
    load()
    // A not-yet-member can't subscribe to invites (RLS), so poll; also refresh on
    // workspace changes once they're in.
    const id = setInterval(load, 8000)
    const off = window.axiroster.onWorkspaceChanged(load)
    return () => {
      clearInterval(id)
      off()
    }
  }, [])

  const respond = async (id: string, action: 'accept' | 'reject'): Promise<void> => {
    setBusy(id)
    try {
      await window.axiroster.respondInvite(id, action)
      load()
      onChange?.()
    } finally {
      setBusy(null)
    }
  }

  if (invites.length === 0) return null
  return (
    <div className="space-y-2 rounded-md border border-accent/40 bg-accent/5 p-3">
      <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-emerald-400">
        <Ticket size={12} /> Pending invites
      </div>
      {invites.map((inv) => (
        <div key={inv.id} className="flex items-center gap-2">
          <div className="min-w-0 flex-1 truncate text-sm text-ink">
            <span className="font-medium">{inv.guildName}</span>
            <span className="chip ml-1.5 px-1.5 py-0 capitalize text-emerald-400">{inv.role}</span>
          </div>
          <button
            onClick={() => void respond(inv.id, 'accept')}
            disabled={busy === inv.id}
            className="btn btn-accent px-2 py-1 text-xs"
          >
            {busy === inv.id ? (
              <RefreshCw size={12} className="animate-spin" />
            ) : (
              <Check size={12} />
            )}
            Accept
          </button>
          <button
            onClick={() => void respond(inv.id, 'reject')}
            disabled={busy === inv.id}
            className="btn px-2 py-1 text-xs text-ink-faint hover:text-red-400"
          >
            <X size={12} /> Reject
          </button>
        </div>
      ))}
    </div>
  )
}
