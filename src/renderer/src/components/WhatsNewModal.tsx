import { useEffect } from 'react'
import { Sparkles, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { client } from '../lib/client'
import Tooltip from './Tooltip'

// In-app release notes ("What's New"). Content is the bundled RELEASE_NOTES.md,
// rendered as markdown into .axi-prose — the package's running-text layer — so
// the notes carry no per-element styling of their own.
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
  const body = (releaseNotes ?? 'Release notes unavailable.')
    .replace(/^#\s*Release Notes\s*/i, '')
    .trim()

  return (
    <>
      <button className="axi-scrim" aria-label="Close release notes" onClick={onClose} />
      <div className="ar-modal" style={{ '--ar-modal-w': '720px', zIndex: 70 } as React.CSSProperties}>
        <div className="ar-modal__sheet">
          <div className="ar-modal__head">
            <div className="axi-notice__icon">
              <Sparkles size={15} />
            </div>
            <div className="flex-1">
              <div className="ar-title">What&apos;s New</div>
              <div className="ar-note--faint">Version {version}</div>
            </div>
            <Tooltip text="Close">
              <button onClick={onClose} className="ar-icon-btn">
                <X size={15} />
              </button>
            </Tooltip>
          </div>

          <div className="ar-modal__body">
            <div className="axi-prose">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  // A markdown link would navigate the renderer; route it to the
                  // OS browser instead. Everything else .axi-prose already draws.
                  a: ({ href, children }) => (
                    <a
                      href={href}
                      onClick={(e) => {
                        e.preventDefault()
                        if (href) client.openExternal(href)
                      }}
                    >
                      {children}
                    </a>
                  )
                }}
              >
                {body}
              </ReactMarkdown>
            </div>
          </div>

          <div className="ar-modal__foot">
            <button onClick={onClose} className="axi-btn axi-btn--primary">
              Continue
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
