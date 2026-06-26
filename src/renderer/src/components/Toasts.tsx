import { useEffect, useState } from 'react'
import { Check, AlertTriangle } from 'lucide-react'
import { subscribeToast, type ToastVariant } from '../lib/toast'

interface Item {
  id: number
  message: string
  variant: ToastVariant
  leaving: boolean
}

let seq = 0

// Bottom-right toast stack. Auto-dismisses; fades out before removal.
export default function Toasts(): JSX.Element {
  const [items, setItems] = useState<Item[]>([])

  useEffect(() => {
    return subscribeToast(({ message, variant = 'success' }) => {
      const id = ++seq
      setItems((cur) => [...cur, { id, message, variant, leaving: false }])
      // Start fade-out, then remove.
      setTimeout(() => {
        setItems((cur) => cur.map((i) => (i.id === id ? { ...i, leaving: true } : i)))
        setTimeout(() => setItems((cur) => cur.filter((i) => i.id !== id)), 200)
      }, 1900)
    })
  }, [])

  return (
    <div className="pointer-events-none absolute bottom-4 right-4 z-[60] flex flex-col items-end gap-2">
      {items.map((i) => (
        <div
          key={i.id}
          className={`flex items-center gap-2 rounded-lg border border-panel-line2 bg-panel-raised px-3 py-2 text-xs text-ink shadow-lg transition-all duration-200 ${
            i.leaving ? 'translate-y-1 opacity-0' : 'translate-y-0 opacity-100'
          }`}
        >
          {i.variant === 'error' ? (
            <AlertTriangle size={13} className="text-red-400" />
          ) : (
            <Check size={13} className="text-emerald-400" />
          )}
          {i.message}
        </div>
      ))}
    </div>
  )
}
