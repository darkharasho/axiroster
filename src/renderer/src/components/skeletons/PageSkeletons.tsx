import { ShieldCheck } from 'lucide-react'
import Bar from './Bar'

const FIELD_W = [96, 120, 84, 108] as const

// A section of labelled fields: eyebrow-height label bar over an input-height bar.
function Fields({ count }: { count: number }): JSX.Element {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div key={i}>
          <div className="axi-eyebrow" style={{ marginBottom: 8 }}><Bar w={FIELD_W[i % FIELD_W.length]} /></div>
          <Bar kind="chip" w="100%" />
        </div>
      ))}
    </>
  )
}

export function SharingSkeleton(): JSX.Element {
  return (
    <div className="ar-pane__body" aria-busy="true" aria-label="Loading sharing…">
      <div className="axi-page axi-page--narrow flex flex-col gap-5">
        <div>
          <h1 className="ar-title">Sharing</h1>
          <p className="ar-note mt-2"><Bar w={280} /></p>
        </div>
        <section className="axi-panel flex flex-col gap-4">
          <div className="ar-section__title"><Bar w={110} /></div>
          <Fields count={3} />
        </section>
      </div>
    </div>
  )
}

export function SettingsSkeleton(): JSX.Element {
  return (
    <div className="ar-pane__body" aria-busy="true" aria-label="Loading settings…">
      <div className="axi-page axi-page--narrow flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <Bar kind="chip" w={64} />
        </div>
        <section className="axi-panel flex flex-col gap-5">
          <div className="flex items-center gap-3">
            <ShieldCheck className="ar-ink-accent" size={18} />
            <h2 className="ar-title">Connection</h2>
          </div>
          <Fields count={1} />
          <div className="ar-section flex flex-col gap-3">
            <div className="ar-section__title"><Bar w={60} /></div>
            <Fields count={3} />
          </div>
        </section>
      </div>
    </div>
  )
}
