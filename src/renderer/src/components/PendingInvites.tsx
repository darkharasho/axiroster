import { useEffect, useState } from 'react'
import { Check, X, RefreshCw, Ticket } from 'lucide-react'
import type { PendingInvite } from '../../../preload/index.d'
import { client } from '../lib/client'

/** The invitee's view: invites pushed to their Discord account, to accept or reject. */
export function PendingInvites({ onChange }: { onChange?: () => void }): JSX.Element | null {
  const [invites, setInvites] = useState<PendingInvite[]>([])
  const [busy, setBusy] = useState<string | null>(null)

  const load = (): void => {
    void client
      .listInvites()
      .then(setInvites)
      .catch(() => setInvites([]))
  }
  useEffect(() => {
    load()
    // A not-yet-member can't subscribe to invites (RLS), so poll; also refresh on
    // workspace changes once they're in.
    const id = setInterval(load, 8000)
    const off = client.onWorkspaceChanged(load)
    return () => {
      clearInterval(id)
      off()
    }
  }, [])

  const respond = async (id: string, action: 'accept' | 'reject'): Promise<void> => {
    setBusy(id)
    try {
      await client.respondInvite(id, action)
      load()
      onChange?.()
    } finally {
      setBusy(null)
    }
  }

  if (invites.length === 0) return null
  return (
    <div className="ar-section flex flex-col gap-3">
      <div className="ar-section__head" style={{ margin: 0 }}>
        <span className="axi-chip axi-chip--accent">
          <Ticket size={12} /> Pending invites
        </span>
      </div>
      {invites.map((inv) => (
        <div key={inv.id} className="flex items-center gap-3">
          <div className="min-w-0 flex-1 truncate">
            <span className="ar-row__name inline">{inv.guildName}</span>
            <span className="axi-chip ml-2">{inv.role}</span>
          </div>
          <button
            onClick={() => void respond(inv.id, 'accept')}
            disabled={busy === inv.id}
            className="axi-btn axi-btn--primary ar-sm"
          >
            {busy === inv.id ? <RefreshCw size={12} className="ar-work" /> : <Check size={12} />}
            Accept
          </button>
          <button
            onClick={() => void respond(inv.id, 'reject')}
            disabled={busy === inv.id}
            className="axi-btn ar-btn--danger ar-sm"
          >
            <X size={12} /> Reject
          </button>
        </div>
      ))}
    </div>
  )
}
