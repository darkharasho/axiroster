// src/renderer/src/components/WebAccountMenu.tsx
// Web-only account chip in the title bar's right slot: avatar + Discord name →
// a dropdown with the workspace role and Sign out. Sign-out clears the session
// and reloads, so WebRoot re-gates to the Landing.
import { useEffect, useRef, useState } from 'react'
import { LogOut, ChevronDown } from 'lucide-react'
import type { AuthStatus } from '../../../preload/index.d'
import { client } from '../lib/client'

export default function WebAccountMenu(): JSX.Element | null {
  const [status, setStatus] = useState<AuthStatus | null>(null)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void client.authStatus().then(setStatus)
  }, [])
  useEffect(() => {
    const onDoc = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onEsc)
    }
  }, [])

  if (!status?.signedIn) return null
  const name = status.name || 'Discord user'
  const initial = name.charAt(0).toUpperCase()
  // A square outlined tile, not a circle: nothing in this language rounds.
  const avatar = (size: string): JSX.Element =>
    status.avatarUrl ? (
      <img src={status.avatarUrl} alt="" className={`ar-guild__tile ${size}`} />
    ) : (
      <span className={`ar-guild__tile ${size}`}>{initial}</span>
    )

  const signOut = async (): Promise<void> => {
    await client.authSignOut()
    globalThis.location?.reload()
  }

  return (
    <div ref={ref} className="axi-menu no-drag">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="ar-account"
      >
        {avatar('h-6 w-6')}
        <span>{name}</span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div
          className="axi-menu__pop"
          style={{ '--axi-menu-width': '224px', left: 'auto', right: 0 } as React.CSSProperties}
        >
          <div className="flex items-center gap-3 p-2">
            {avatar('h-8 w-8')}
            <div className="min-w-0">
              <div className="ar-row__name">{name}</div>
              {status.role && <span className="axi-chip mt-1">{status.role}</span>}
            </div>
          </div>
          <div className="ar-pop__foot">
            <button onClick={signOut} className="ar-pop__item ar-pop__item--danger">
              <LogOut size={15} /> Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
