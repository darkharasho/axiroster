import logo from '../renderer/src/assets/axiroster-logo.svg'

function DiscordIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 127.14 96.36" fill="currentColor" className="h-[21px] w-[21px]" aria-hidden>
      <path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,46,96.12,53,91.08,65.69,84.69,65.69Z" />
    </svg>
  )
}

/** Signed-out front door for the web build. `busy` shows a connecting state while
 *  the OAuth redirect is kicking off. */
export default function Landing({
  onSignIn,
  busy = false
}: {
  onSignIn: () => void
  busy?: boolean
}): JSX.Element {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-panel text-ink">
      <div className="relative z-10 flex flex-col items-center px-10 text-center">
        {/* logo group — the emerald aura is anchored behind the logo/wordmark */}
        <div className="relative flex flex-col items-center">
          <div
            className="pointer-events-none absolute left-1/2 top-[46%] -z-10 h-[560px] w-[560px] -translate-x-1/2 -translate-y-1/2 rounded-full blur-md"
            style={{ background: 'radial-gradient(circle, rgba(16,185,129,.20), rgba(16,185,129,0) 60%)' }}
          />
          <img
            src={logo}
            alt="AxiRoster"
            className="h-24 w-24"
            style={{ filter: 'drop-shadow(0 8px 26px rgba(4,120,87,.5))' }}
          />
          <div className="mt-5 text-[34px] font-extrabold tracking-tight">
            Axi<span className="text-accent-soft">Roster</span>
          </div>
          <p className="mt-2.5 max-w-[440px] text-[15px] leading-relaxed text-ink-dim">
            Guild Wars 2 WvW roster &amp; leadership tools — live rosters, retention, recruitment, and
            audit, shared across your guild.
          </p>
        </div>
        <div className="mt-8 w-[380px] rounded-2xl border border-panel-line bg-gradient-to-b from-[#232327] to-[#202023] p-6 shadow-2xl">
          <h2 className="text-[15px] font-semibold text-ink">Sign in to your guild</h2>
          <p className="mt-1.5 text-[13px] leading-snug text-ink-faint">
            Use the Discord account linked to your guild&apos;s workspace.
          </p>
          <button
            type="button"
            onClick={onSignIn}
            disabled={busy}
            className="mt-5 flex h-[46px] w-full items-center justify-center gap-2.5 rounded-xl bg-[#5865F2] text-[15px] font-semibold text-white shadow-lg transition hover:bg-[#4752e0] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
          >
            <DiscordIcon />
            {busy ? 'Connecting…' : 'Sign in with Discord'}
          </button>
          <div className="mt-3.5 text-[12px] text-ink-faint">
            No workspace yet? <span className="text-ink-dim">Ask your guild lead for an invite.</span>
          </div>
        </div>
        <div className="mt-8 text-[12px] text-panel-line2">AxiRoster · roster.axi.link</div>
      </div>
    </div>
  )
}
