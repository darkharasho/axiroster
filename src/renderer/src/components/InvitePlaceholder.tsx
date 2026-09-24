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
      <div className="axi-panel flex w-full max-w-md flex-col items-center gap-5 text-center">
        <div className="axi-notice__icon" style={{ width: 40, height: 40 }}>
          <Mail size={20} />
        </div>

        <div className="flex flex-col items-center gap-2">
          <h2 className="ar-title">Workspace invitation</h2>
          <p className="ar-note">You&apos;ve been invited to join</p>
          <div className="flex items-center justify-center gap-3">
            <span style={{ font: 'var(--axi-t-h2)', letterSpacing: 'var(--axi-ls-h2)' }}>
              {invite.guildName}
            </span>
            <span className="axi-chip axi-chip--accent">{invite.role}</span>
          </div>
        </div>

        <p className="ar-note--faint">
          Accept to add this guild to your roster and sync with its officers. Reject to dismiss the
          invite.
        </p>

        <div className="flex w-full gap-3">
          <button
            onClick={() => void respond('accept')}
            disabled={busy !== null}
            className="axi-btn axi-btn--primary flex-1 justify-center"
          >
            {busy === 'accept' ? <Loader2 size={14} className="ar-work" /> : <Check size={14} />}
            Accept
          </button>
          <button
            onClick={() => void respond('reject')}
            disabled={busy !== null}
            className="axi-btn ar-btn--danger flex-1 justify-center"
          >
            {busy === 'reject' ? <Loader2 size={14} className="ar-work" /> : <X size={14} />}
            Reject
          </button>
        </div>
      </div>
    </div>
  )
}
