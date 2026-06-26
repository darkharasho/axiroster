import { useState } from 'react'
import { Mail, Check, X, Loader2 } from 'lucide-react'
import type { PendingInvite } from '../../../preload/index.d'

/** The standalone view for a placeholder "invited" guild in the rail: shows where
 *  the invite came from and lets the user accept (→ the guild populates) or
 *  reject (→ the placeholder disappears). */
export default function InvitePlaceholder({
  invite,
  onRespond
}: {
  invite: PendingInvite
  onRespond: (invite: PendingInvite, action: 'accept' | 'reject') => Promise<void>
}): JSX.Element {
  const [busy, setBusy] = useState<'accept' | 'reject' | null>(null)

  const respond = async (action: 'accept' | 'reject'): Promise<void> => {
    setBusy(action)
    try {
      await onRespond(invite, action)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="grid flex-1 place-items-center p-8">
      <div className="w-full max-w-md space-y-5 rounded-xl border border-panel-line bg-panel-raised/40 p-7 text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-accent/12">
          <Mail size={20} className="text-accent" />
        </div>

        <div className="space-y-1">
          <h2 className="text-base font-semibold text-white">Workspace invitation</h2>
          <p className="text-sm text-ink-dim">You&apos;ve been invited to join</p>
          <div className="flex items-center justify-center gap-2 pt-1">
            <span className="text-lg font-semibold text-white">{invite.guildName}</span>
            <span className="rounded-full bg-accent/16 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide capitalize text-accent">
              {invite.role}
            </span>
          </div>
        </div>

        <p className="text-xs text-ink-faint">
          Accept to add this guild to your roster and sync with its officers. Reject to dismiss the
          invite.
        </p>

        <div className="flex gap-2 pt-1">
          <button
            onClick={() => void respond('accept')}
            disabled={busy !== null}
            className="btn btn-accent flex-1 justify-center"
          >
            {busy === 'accept' ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            Accept
          </button>
          <button
            onClick={() => void respond('reject')}
            disabled={busy !== null}
            className="btn flex-1 justify-center text-ink-faint hover:text-red-400"
          >
            {busy === 'reject' ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
            Reject
          </button>
        </div>
      </div>
    </div>
  )
}
