import accentsJson from '@axiapps/axi-design/accents.json'

export type AccentDefinition = { id: string; label: string; hex: string }

export const ACCENTS: AccentDefinition[] = accentsJson as AccentDefinition[]

/** AxiRoster was emerald before the redesign, so it stays emerald by default. */
export const DEFAULT_ACCENT_ID = 'emerald-mint'

// Settings written before the redesign named a Tailwind palette rather than an
// accent id. Nothing in AxiRoster ever let the user pick one — the emerald was
// hard-coded — but the two names that were stored alongside it (on the web
// build's theme-color meta, and in anything that round-tripped the old accent
// name) map here so a value read back from disk resolves rather than silently
// falling back.
const LEGACY_THEME_TO_ACCENT: Record<string, string> = {
  emerald: 'emerald-mint',
  accent: 'emerald-mint'
}

export function resolveAccentId(id?: string | null): string {
  if (id && ACCENTS.some((a) => a.id === id)) return id
  if (id && LEGACY_THEME_TO_ACCENT[id]) return LEGACY_THEME_TO_ACCENT[id]
  return DEFAULT_ACCENT_ID
}
