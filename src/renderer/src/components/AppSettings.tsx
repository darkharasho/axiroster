import { useEffect, useState } from 'react'
import { RefreshCw, ShieldCheck, MessageSquare, X, Loader2, Sparkles } from 'lucide-react'
import type { AuthStatus } from '../../../preload/index.d'
import { client } from '../lib/client'
import { CheckForUpdates } from './CheckForUpdates'
import { isWeb } from '../lib/runtime'
import { ACCENTS } from '../themes/accents'
import { applyTheme, readAccent } from '../themes/applyTheme'
import Tooltip from './Tooltip'

// App-level settings (the sidebar cog): your Discord account, the accent, and
// app updates. These are the only truly global surfaces — everything else is
// per-guild.
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
  const [accent, setAccent] = useState(readAccent)

  const loadStatus = async (): Promise<void> => {
    const [auth, sync, ver] = await Promise.all([
      client.authStatus(),
      client.syncStatus(),
      client.appVersion()
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
      await client.authSignIn()
      await loadStatus()
    } finally {
      setSigningIn(false)
    }
  }

  const handleSignOut = async (): Promise<void> => {
    await client.authSignOut()
    setAuthStatus({ signedIn: false })
    setSyncStatus('disabled')
  }

  const pickAccent = (id: string): void => setAccent(applyTheme(id))

  return (
    <>
      <button className="axi-scrim" aria-label="Close settings" onClick={onClose} />
      <div className="ar-modal" style={{ '--ar-modal-w': '560px' } as React.CSSProperties}>
        <div className="ar-modal__sheet" onClick={(e) => e.stopPropagation()}>
          <div className="ar-modal__head">
            <h1 className="ar-title flex-1">App settings</h1>
            <Tooltip text="Close">
              <button onClick={onClose} className="ar-icon-btn">
                <X size={15} />
              </button>
            </Tooltip>
          </div>

          <div className="ar-modal__body flex flex-col gap-4">
            {/* Account */}
            <section className="ar-section">
              <div className="ar-section__head">
                <h2 className="ar-section__title">Discord account</h2>
              </div>
              <p className="ar-note mb-3">
                One sign-in for the whole app. Sharing &amp; roles are managed per guild.
              </p>

              {authStatus === null ? (
                <div className="ar-note--faint flex items-center gap-2">
                  <Loader2 size={14} className="ar-work" /> Loading…
                </div>
              ) : !authStatus.signedIn ? (
                <button onClick={handleSignIn} disabled={signingIn} className="axi-btn axi-btn--primary">
                  {signingIn ? (
                    <RefreshCw size={14} className="ar-work" />
                  ) : (
                    <MessageSquare size={14} />
                  )}
                  {signingIn ? 'Signing in…' : 'Sign in with Discord'}
                </button>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="axi-legend__key">
                      <ShieldCheck className="ar-ink-ok" size={14} />
                      <span>Signed in</span>
                    </div>
                    <div className="ar-note--faint mt-1">Sync engine: {syncStatus}</div>
                  </div>
                  <button onClick={handleSignOut} className="axi-btn">
                    Sign out
                  </button>
                </div>
              )}
            </section>

            {/* Accent — the one per-app theming surface the language exposes. */}
            <section className="ar-section">
              <div className="ar-section__head">
                <h2 className="ar-section__title">Accent</h2>
                <span className="ar-note--faint">
                  {ACCENTS.find((a) => a.id === accent)?.label ?? accent}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {ACCENTS.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => pickAccent(a.id)}
                    className={`ar-swatch${a.id === accent ? ' ar-swatch--on' : ''}`}
                    style={{ '--axi-series': a.hex } as React.CSSProperties}
                    title={a.label}
                    aria-label={a.label}
                    aria-pressed={a.id === accent}
                  />
                ))}
              </div>
            </section>

            {/* Updates — desktop only (no auto-updater or release notes on web) */}
            {!isWeb() && (
              <section className="ar-section">
                <div className="ar-section__head">
                  <h2 className="ar-section__title">Updates</h2>
                  {version && <span className="ar-note--faint">v{version}</span>}
                </div>
                <div className="flex flex-col gap-3">
                  <CheckForUpdates />
                  <button onClick={onShowWhatsNew} className="axi-btn justify-center">
                    <Sparkles size={14} /> What&apos;s new in this version
                  </button>
                </div>
              </section>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
