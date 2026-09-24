import { resolveAccentId, DEFAULT_ACCENT_ID } from './accents'

// Where the chosen accent lives. Renderer-side rather than in the guild store
// so the desktop and web builds share one code path and the accent is applied
// before the first paint, with no round trip through the main process.
const STORAGE_KEY = 'axiroster.accent'

let transitionTimer: ReturnType<typeof setTimeout> | null = null

export function readAccent(): string {
  try {
    return resolveAccentId(localStorage.getItem(STORAGE_KEY))
  } catch {
    return DEFAULT_ACCENT_ID
  }
}

/**
 * Put an accent on <html> and remember it. The crossfade class is added for
 * the length of the transition so the whole app changes colour together
 * instead of each element snapping on its own next repaint.
 */
export function applyTheme(accentId?: string | null): string {
  const id = resolveAccentId(accentId)
  const root = document.documentElement

  root.classList.add('theme-transitioning')
  if (transitionTimer) clearTimeout(transitionTimer)
  transitionTimer = setTimeout(() => {
    root.classList.remove('theme-transitioning')
    transitionTimer = null
  }, 500)

  root.setAttribute('data-axi-accent', id)
  try {
    localStorage.setItem(STORAGE_KEY, id)
  } catch {
    // A private-mode browser with storage disabled still gets the accent for
    // the life of the session; only the memory of it is lost.
  }
  return id
}
