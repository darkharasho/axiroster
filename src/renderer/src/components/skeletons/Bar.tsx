import type { CSSProperties } from 'react'

type Kind = 'text' | 'figure' | 'chip' | 'tile'

// One .axi-skeleton bar. It sits inside the real element it stands in for, so
// its height follows that element's font; `w` sets --axi-skeleton-w.
export default function Bar({ w, kind = 'text' }: { w?: number | string; kind?: Kind }): JSX.Element {
  const style =
    w === undefined
      ? undefined
      : ({ '--axi-skeleton-w': typeof w === 'number' ? `${w}px` : w } as CSSProperties)
  return (
    <span
      className={kind === 'text' ? 'axi-skeleton' : `axi-skeleton axi-skeleton--${kind}`}
      style={style}
      aria-hidden="true"
    />
  )
}

/** Widths cycle through a fixed list, so every render draws the same skeleton. */
export function widthAt(widths: readonly number[], i: number): number {
  return widths[i % widths.length]
}
