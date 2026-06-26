/**
 * Pure helpers for the Discord OAuth callback flow.
 * Extracted for testability — no Electron / Node side-effects.
 */

/**
 * Extract the `code` query parameter from an axiroster:// deep-link URL.
 * Returns null if the parameter is absent or empty.
 */
export function codeFromCallback(url: string): string | null {
  try {
    const parsed = new URL(url)
    const code = parsed.searchParams.get('code')
    return code || null
  } catch {
    return null
  }
}
