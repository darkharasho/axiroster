import logo from '../renderer/src/assets/axiroster-logo.svg'

function DiscordIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 127.14 96.36" fill="currentColor" className="h-[18px] w-[18px]" aria-hidden>
      <path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,46,96.12,53,91.08,65.69,84.69,65.69Z" />
    </svg>
  )
}

/** Signed-out front door for the web build. `busy` shows a connecting state while
 *  the OAuth redirect is kicking off.
 *
 *  Flat and outlined: the emerald aura, the drop shadow, the surface gradient and
 *  the Discord blurple are all gone. What used to be carried by a glow is carried
 *  by the outline and the block, and the sign-in button is the accent — the one
 *  colour the app is themed by. */
export default function Landing({
  onSignIn,
  busy = false
}: {
  onSignIn: () => void
  busy?: boolean
}): JSX.Element {
  return (
    <div className="grid min-h-screen place-items-center p-8">
      <div className="flex flex-col items-center gap-8 text-center">
        <div className="flex flex-col items-center gap-4">
          <span
            role="img"
            aria-label="AxiRoster"
            className="ar-brandmark h-20 w-20"
            style={{ '--ar-mark': `url(${logo})` } as React.CSSProperties}
          />
          <div style={{ font: 'var(--axi-t-h1)', letterSpacing: 'var(--axi-ls-h1)' }}>
            Axi<span className="ar-ink-accent">Roster</span>
          </div>
          <p className="ar-note max-w-[440px]">
            Guild Wars 2 WvW roster &amp; leadership tools — live rosters, retention, recruitment,
            and audit, shared across your guild.
          </p>
        </div>

        <div className="axi-panel flex w-[380px] flex-col items-stretch gap-3 text-left">
          <h2 className="ar-title">Sign in to your guild</h2>
          <p className="ar-note--faint">
            Use the Discord account linked to your guild&apos;s workspace.
          </p>
          <button
            type="button"
            onClick={onSignIn}
            disabled={busy}
            className="axi-btn axi-btn--primary mt-2 justify-center"
          >
            <DiscordIcon />
            {busy ? 'Connecting…' : 'Sign in with Discord'}
          </button>
          <div className="ar-note--faint">
            No workspace yet?{' '}
            <span className="ar-ink-dim">Ask your guild lead for an invite.</span>
          </div>
        </div>

        <div className="axi-stat__k">AxiRoster · roster.axi.link</div>
      </div>
    </div>
  )
}
