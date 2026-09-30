import { resolveAccentId, DEFAULT_ACCENT_ID } from './accents'

// Where the chosen accent lives. Renderer-side rather than in the guild store
// so the desktop and web builds share one code path and the accent is applied
// before the first paint, with no round trip through the main process.
const STORAGE_KEY = 'axiroster.accent'

// The surface rides alongside the accent and for the same reasons: one key, read
// before the first render, no main-process round trip. The two are independent —
// every accent works on either surface.
//
// The key is versioned because 'flat' changed meaning. It used to name the
// design language itself (no `data-axi-theme` at all); since axi-design 1.41.0
// there is a real `flat` theme, so the language is 'axi' here and 'flat' is the
// theme. Reading the old key under the new vocabulary would silently move
// everyone who had ever opened Settings onto a paint they never chose, so the
// old value is migrated once through readSurface() instead.
const SURFACE_STORAGE_KEY = 'axiroster.surface.v2'
const LEGACY_SURFACE_STORAGE_KEY = 'axiroster.surface'

/**
 * The surfaces the design language paints. 'axi' is the language itself, drawn
 * with no `data-axi-theme` at all — a hard outline, a hard offset block and
 * square corners. The other two are repaints of it shipped as
 * `@axiapps/axi-design/themes/<id>.css`: 'flat' trades the block for a soft
 * drop and rounds the corners, and 'glass' makes the panels translucent and
 * blurs what sits behind popovers and modals.
 */
export type SurfaceId = 'axi' | 'flat' | 'glass'

export const SURFACES: { id: SurfaceId; label: string }[] = [
  { id: 'axi', label: 'Axi' },
  { id: 'flat', label: 'Flat' },
  { id: 'glass', label: 'Glass' }
]

/** AxiRoster has always been drawn in the language itself, so that stays the default. */
export const DEFAULT_SURFACE_ID: SurfaceId = 'axi'

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

/**
 * Translate a value stored under the pre-1.41.0 vocabulary. Only 'flat' and
 * 'glass' were ever written there, and only 'flat' moved: it meant the language,
 * which is 'axi' now.
 */
function migrateLegacySurfaceId(id: string | null): SurfaceId {
  return id === 'glass' ? 'glass' : DEFAULT_SURFACE_ID
}

export function readSurface(): SurfaceId {
  try {
    const stored = localStorage.getItem(SURFACE_STORAGE_KEY)
    if (stored !== null) return resolveSurfaceId(stored)
    // Nothing under the current key: either a first run, or an install that
    // last chose a surface before 'flat' became a theme of its own.
    return migrateLegacySurfaceId(localStorage.getItem(LEGACY_SURFACE_STORAGE_KEY))
  } catch {
    return DEFAULT_SURFACE_ID
  }
}

/**
 * Put a surface on <html> and remember it. 'axi' removes the attribute rather
 * than naming itself: the language is not a theme layered over itself, and the
 * design language's own rule is that removing `data-axi-theme` leaves you back
 * on it with no other change.
 */
export function applySurface(surfaceId?: string | null): SurfaceId {
  const id = resolveSurfaceId(surfaceId)
  const root = document.documentElement

  crossfade(root)

  if (id === 'axi') root.removeAttribute('data-axi-theme')
  else root.setAttribute('data-axi-theme', id)

  try {
    localStorage.setItem(SURFACE_STORAGE_KEY, id)
  } catch {
    // Same bargain as the accent: applied now, just not remembered.
  }
  return id
}
