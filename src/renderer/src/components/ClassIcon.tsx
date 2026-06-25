// Class/elite-spec icons from the gw2-class-icons package. The SVGs are named by
// spec (Firebrand.svg, Luminary.svg, …) which matches the profession strings in
// AxiBridge's rollup, so we map a class name straight to its icon URL. Vite
// copies the SVGs as assets via the eager glob below (works in dev + packaged).

// Relative path from this file to the package's SVG folder at the repo root
// (src/renderer/src/components -> ../../../../node_modules/...).
const modules = import.meta.glob(
  '../../../../node_modules/gw2-class-icons/wiki/svg/*.svg',
  { eager: true, query: '?url', import: 'default' }
) as Record<string, string>

// basename (without .svg, lower-cased) -> asset url
const byName = new Map<string, string>()
for (const [path, url] of Object.entries(modules)) {
  const base = path.split('/').pop()?.replace(/\.svg$/i, '') ?? ''
  if (base) byName.set(base.toLowerCase(), url)
}

export function classIconUrl(name: string | null | undefined): string | null {
  if (!name) return null
  return byName.get(name.trim().toLowerCase()) ?? null
}

export default function ClassIcon({
  name,
  size = 16,
  className = ''
}: {
  name: string | null | undefined
  size?: number
  className?: string
}): JSX.Element | null {
  const url = classIconUrl(name)
  if (!url) return null
  return (
    <img
      src={url}
      alt={name ?? ''}
      title={name ?? ''}
      width={size}
      height={size}
      className={`inline-block shrink-0 ${className}`}
    />
  )
}
