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
  const avatar = (size: string, text: string): JSX.Element =>
    status.avatarUrl ? (
      <img src={status.avatarUrl} alt="" className={`${size} rounded-full`} />
    ) : (
      <span className={`${size} grid place-items-center rounded-full bg-accent ${text} font-bold text-white`}>
        {initial}
      </span>
    )

  const signOut = async (): Promise<void> => {
    await client.authSignOut()
    globalThis.location?.reload()
  }

  return (
    <div ref={ref} className="no-drag relative mr-1">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-lg border border-transparent px-2 py-1 transition hover:border-panel-line hover:bg-panel-hover"
      >
        {avatar('h-6 w-6', 'text-[11px]')}
        <span className="text-[12.5px] font-semibold text-ink">{name}</span>
        <ChevronDown size={14} className="text-ink-faint" />
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-50 w-56 overflow-hidden rounded-xl border border-panel-line bg-panel-raised shadow-raise-lg">
          <div className="flex items-center gap-2.5 p-3">
            {avatar('h-8 w-8', 'text-[13px]')}
            <div className="min-w-0">
              <div className="truncate text-[13px] font-semibold text-white">{name}</div>
              {status.role && (
                <span className="mt-0.5 inline-block rounded-full bg-emerald-500/14 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-emerald-400">
                  {status.role}
                </span>
              )}
            </div>
          </div>
          <div className="h-px bg-panel-line" />
          <button
            onClick={signOut}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[12.5px] text-red-400 transition hover:bg-red-500/10"
          >
            <LogOut size={15} /> Sign out
          </button>
        </div>
      )}
    </div>
  )
}
