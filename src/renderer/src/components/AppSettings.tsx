import { useEffect, useState } from 'react'
import { RefreshCw, ShieldCheck, MessageSquare, X, Loader2, Sparkles } from 'lucide-react'
import type { AuthStatus } from '../../../preload/index.d'
import { CheckForUpdates } from './CheckForUpdates'

// App-level settings (the sidebar cog): your Discord account + app updates.
// These are the only truly global surfaces — everything else is per-guild.
export default function AppSettings({
  onClose,
  onShowWhatsNew
}: {
  onClose: () => void
  onShowWhatsNew: () => void
}): JSX.Element {
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null)
  const [syncStatus, setSyncStatus] = useState('disabled')
  const [signingIn, setSigningIn] = useState(false)
  const [version, setVersion] = useState('')

  const loadStatus = async (): Promise<void> => {
    const [auth, sync, ver] = await Promise.all([
      window.axiroster.authStatus(),
      window.axiroster.syncStatus(),
      window.axiroster.appVersion()
    ])
    setAuthStatus(auth)
    setSyncStatus(sync)
    setVersion(ver)
  }

  useEffect(() => {
    void loadStatus()
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [])

  const handleSignIn = async (): Promise<void> => {
    setSigningIn(true)
    try {
      await window.axiroster.authSignIn()
      await loadStatus()
    } finally {
      setSigningIn(false)
    }
  }

  const handleSignOut = async (): Promise<void> => {
    await window.axiroster.authSignOut()
    setAuthStatus({ signedIn: false })
    setSyncStatus('disabled')
  }

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg space-y-5 rounded-xl border border-panel-line bg-panel p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h1 className="text-base font-semibold text-white">App settings</h1>
          <button onClick={onClose} className="btn px-2 text-ink-faint hover:text-ink" title="Close">
            <X size={16} />
          </button>
        </div>

        {/* Account */}
        <section className="space-y-3 rounded-lg border border-panel-line bg-panel-raised/40 p-5">
          <div>
            <h2 className="text-sm font-semibold text-white">Discord account</h2>
            <p className="mt-0.5 text-xs text-ink-dim">
              One sign-in for the whole app. Sharing &amp; roles are managed per guild.
            </p>
          </div>

          {authStatus === null ? (
            <div className="flex items-center gap-2 text-xs text-ink-faint">
              <Loader2 size={14} className="animate-spin" /> Loading…
            </div>
          ) : !authStatus.signedIn ? (
            <button onClick={handleSignIn} disabled={signingIn} className="btn btn-accent">
              {signingIn ? (
                <RefreshCw size={14} className="animate-spin" />
              ) : (
                <MessageSquare size={14} />
              )}
              {signingIn ? 'Signing in…' : 'Sign in with Discord'}
            </button>
          ) : (
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2 text-sm text-ink">
                  <ShieldCheck size={14} className="text-emerald-400" />
                  <span>Signed in</span>
                </div>
                <div className="text-xs text-ink-dim">Sync engine: {syncStatus}</div>
              </div>
              <button
                onClick={handleSignOut}
                className="btn text-xs text-ink-faint hover:text-red-400"
              >
                Sign out
              </button>
            </div>
          )}
        </section>

        {/* Updates */}
        <section className="space-y-3 rounded-lg border border-panel-line bg-panel-raised/40 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Updates</h2>
            {version && <span className="text-xs text-ink-faint">v{version}</span>}
          </div>
          <CheckForUpdates />
          <button onClick={onShowWhatsNew} className="btn w-full justify-center">
            <Sparkles size={14} /> What&apos;s new in this version
          </button>
        </section>
      </div>
    </div>
  )
}
