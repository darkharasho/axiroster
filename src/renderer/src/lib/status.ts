import type { RosterStatus } from '../../../preload/index.d'

/** LED color + human label for each reconciliation status. */
export const STATUS_META: Record<RosterStatus, { color: string; label: string }> = {
  verified: { color: '#22c55e', label: 'In guild' },
  linked: { color: '#3b82f6', label: 'Linked' },
  'no-key': { color: '#f59e0b', label: 'No GW2 key' },
  'left-guild': { color: '#ef4444', label: 'Left guild' },
  unlinked: { color: '#a8a29e', label: 'Unlinked' }
}

export function fmtDuration(ms: number): string {
  if (!ms || ms < 0) return '—'
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export function fmtRelative(iso: string | null): string {
  if (!iso) return '—'
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return '—'
  const days = Math.floor((Date.now() - then) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}
