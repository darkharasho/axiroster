import { useEffect } from 'react'
import { Sparkles, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// In-app release notes ("What's New"). Content is the bundled RELEASE_NOTES.md,
// rendered as markdown. Shown automatically after an update and reopenable from
// the app-settings cog.
export default function WhatsNewModal({
  version,
  releaseNotes,
  onClose
}: {
  version: string
  releaseNotes: string | null
  onClose: () => void
}): JSX.Element {
  useEffect(() => {
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [onClose])

  // The modal header already shows the title — drop a leading "# Release Notes".
  const body = (releaseNotes ?? 'Release notes unavailable.').replace(/^#\s*Release Notes\s*/i, '').trim()

  return (
    <div
      className="absolute inset-0 z-[70] flex items-center justify-center bg-black/55 p-6"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-panel-line bg-panel shadow-2xl">
        <div className="flex items-center justify-between border-b border-panel-line px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-lg border border-accent/30 bg-accent/15">
              <Sparkles size={18} className="text-accent" />
            </div>
            <div>
              <div className="text-base font-semibold text-white">What&apos;s New</div>
              <div className="text-xs text-ink-faint">Version {version}</div>
            </div>
          </div>
          <button onClick={onClose} className="btn px-2 text-ink-faint hover:text-ink" title="Close">
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="space-y-3 text-sm text-ink-dim">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                h1: ({ children }) => <h1 className="text-lg font-bold text-white">{children}</h1>,
                h2: ({ children }) => (
                  <h2 className="pt-2 text-sm font-semibold uppercase tracking-wide text-accent-soft">
                    {children}
                  </h2>
                ),
                h3: ({ children }) => <h3 className="text-sm font-semibold text-white">{children}</h3>,
                p: ({ children }) => <p className="leading-6 text-ink-dim">{children}</p>,
                ul: ({ children }) => <ul className="list-disc space-y-1 pl-5 text-ink-dim">{children}</ul>,
                ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5 text-ink-dim">{children}</ol>,
                li: ({ children }) => <li className="leading-6">{children}</li>,
                strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
                a: ({ href, children }) => (
                  <button
                    className="text-accent underline underline-offset-2 hover:text-accent-soft"
                    onClick={() => href && window.axiroster.openExternal(href)}
                  >
                    {children}
                  </button>
                ),
                code: ({ children }) => (
                  <code className="rounded bg-black/40 px-1.5 py-0.5 text-[11px] text-accent-soft">
                    {children}
                  </code>
                )
              }}
            >
              {body}
            </ReactMarkdown>
          </div>
        </div>

        <div className="flex justify-end border-t border-panel-line px-6 py-4">
          <button onClick={onClose} className="btn btn-accent">
            Continue
          </button>
        </div>
      </div>
    </div>
  )
}
