import { resolveAccentId, DEFAULT_ACCENT_ID } from './accents'

// Where the chosen accent lives. Renderer-side rather than in the guild store
// so the desktop and web builds share one code path and the accent is applied
// before the first paint, with no round trip through the main process.
const STORAGE_KEY = 'axiroster.accent'

// The surface rides alongside the accent and for the same reasons: one key, read
// before the first render, no main-process round trip. The two are independent —
// every accent works on either surface.
const SURFACE_STORAGE_KEY = 'axiroster.surface'

/**
 * The surfaces the design language paints. 'flat' is the main theme — the
 * language itself, drawn with no `data-axi-theme` at all — and 'glass' is the
 * translucent repaint shipped as `@axiapps/axi-design/themes/glass.css`.
 */
export type SurfaceId = 'flat' | 'glass'

export const SURFACES: { id: SurfaceId; label: string }[] = [
  { id: 'flat', label: 'Flat' },
  { id: 'glass', label: 'Glass' }
]

/** AxiRoster has always been drawn flat, so that stays the default. */
export const DEFAULT_SURFACE_ID: SurfaceId = 'flat'

let transitionTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Hold the crossfade class on <html> for the length of the transition so the
 * whole app changes together instead of each element snapping on its own next
 * repaint. Shared by the accent and the surface: changing both at once should
 * still be one fade, so the timer is deliberately not per-attribute.
 */
function crossfade(root: Element): void {
  root.classList.add('theme-transitioning')
  if (transitionTimer) clearTimeout(transitionTimer)
  transitionTimer = setTimeout(() => {
    root.classList.remove('theme-transitioning')
    transitionTimer = null
  }, 500)
}

export function readAccent(): string {
  try {
    return resolveAccentId(localStorage.getItem(STORAGE_KEY))
  } catch {
    return DEFAULT_ACCENT_ID
  }
}

/**
 * Put an accent on <html> and remember it.
 */
export function applyTheme(accentId?: string | null): string {
  const id = resolveAccentId(accentId)
  const root = document.documentElement

  crossfade(root)

  root.setAttribute('data-axi-accent', id)
  try {
    localStorage.setItem(STORAGE_KEY, id)
  } catch {
    // A private-mode browser with storage disabled still gets the accent for
    // the life of the session; only the memory of it is lost.
  }
  return id
}

export function resolveSurfaceId(id?: string | null): SurfaceId {
  return SURFACES.some((s) => s.id === id) ? (id as SurfaceId) : DEFAULT_SURFACE_ID
}

export function readSurface(): SurfaceId {
  try {
    return resolveSurfaceId(localStorage.getItem(SURFACE_STORAGE_KEY))
  } catch {
    return DEFAULT_SURFACE_ID
  }
}

/**
 * Put a surface on <html> and remember it. Flat removes the attribute rather
 * than naming itself: the main theme is the language, not a theme layered over
 * it, and the design language's own rule is that removing `data-axi-theme`
 * leaves you back on it with no other change.
 */
export function applySurface(surfaceId?: string | null): SurfaceId {
  const id = resolveSurfaceId(surfaceId)
  const root = document.documentElement

  crossfade(root)

  if (id === 'flat') root.removeAttribute('data-axi-theme')
  else root.setAttribute('data-axi-theme', id)

  try {
    localStorage.setItem(SURFACE_STORAGE_KEY, id)
  } catch {
    // Same bargain as the accent: applied now, just not remembered.
  }
  return id
}
