// Tiny global toast bus. Any component can fire a toast; the <Toasts/> host
// (mounted once in App) renders them. Decoupled so deep components (MemberDetail,
// GuildEditor) don't need a context provider threaded through.

export type ToastVariant = 'success' | 'error'
export interface ToastInput {
  message: string
  variant?: ToastVariant
}

type Listener = (t: ToastInput) => void
const listeners = new Set<Listener>()

export function toast(message: string, variant: ToastVariant = 'success'): void {
  for (const l of listeners) l({ message, variant })
}

export function subscribeToast(cb: Listener): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}
