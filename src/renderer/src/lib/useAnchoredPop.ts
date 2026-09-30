// src/renderer/src/lib/useAnchoredPop.ts
//
// Where a portaled popover lands. Picker and TagChooser both take the
// package's --fixed contract (axi.css:1025): append the popover to <body> and
// set left/top from script, having measured the trigger — because both sit
// inside panes that scroll, which clips an absolute list and eats the offset
// block that falls outside its box, and because every hover lift in this
// language is a transform, which re-anchors a fixed child to the lifted
// ancestor.
//
// This owns the measuring only. Dismissal stays with each component, which
// wants it differently: the picker returns focus to its trigger on Escape,
// the chooser just unmounts.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

/** Clearance kept between the popover and the viewport's edges. */
const EDGE = 8
/** The offset block's width — the gap the language leaves under a popover. */
const GAP = 9

export interface PopBox {
  left: number
  top: number
  /** The trigger's width, for a list that must never be narrower than its box. */
  width: number
  /** The language's cap, lowered to whatever room the chosen side actually has. */
  maxHeight: number
  /** False once the pane has scrolled the trigger out of sight. */
  visible: boolean
}

function same(a: PopBox | null, b: PopBox): boolean {
  return (
    a !== null &&
    a.left === b.left &&
    a.top === b.top &&
    a.width === b.width &&
    a.maxHeight === b.maxHeight &&
    a.visible === b.visible
  )
}

/**
 * The rectangle the trigger is actually visible within: the viewport,
 * intersected with every ancestor that clips. Without this the popover follows
 * its trigger out of a scrolling panel and floats over unrelated chrome.
 */
function clipRect(el: HTMLElement): DOMRect {
  let box = new DOMRect(0, 0, window.innerWidth, window.innerHeight)
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p)
    if (o.overflowX === 'visible' && o.overflowY === 'visible') continue
    const r = p.getBoundingClientRect()
    const left = Math.max(box.left, r.left)
    const top = Math.max(box.top, r.top)
    box = new DOMRect(
      left,
      top,
      Math.max(0, Math.min(box.right, r.right) - left),
      Math.max(0, Math.min(box.bottom, r.bottom) - top)
    )
  }
  return box
}

/** A rectangle, as much of one as the placement needs. */
export interface Rect {
  top: number
  bottom: number
  left: number
  width: number
}

/**
 * Where the popover goes, given measurements. Pure, so the part with the edge
 * cases in it is node-testable without a DOM.
 *
 * `want` is the height the popover would take if nothing constrained it — but
 * already no taller than the language's own max-height, since both popovers
 * cap at 340px and scroll past it.
 */
export function placeAnchored({
  anchor,
  clip,
  want,
  popWidth,
  viewport,
  placement = 'down'
}: {
  anchor: Rect
  clip: { top: number; bottom: number }
  want: number
  popWidth: number
  viewport: { width: number; height: number }
  placement?: 'down' | 'up'
}): PopBox {
  const roomBelow = viewport.height - EDGE - (anchor.bottom + GAP)
  const roomAbove = anchor.top - GAP - EDGE
  const wantedFits = placement === 'up' ? want <= roomAbove : want <= roomBelow
  const otherFits = placement === 'up' ? want <= roomBelow : want <= roomAbove

  // The requested side wins unless it doesn't fit and the other one does; when
  // neither fits, take the roomier one and let the cap do the rest.
  let down = placement !== 'up'
  if (!wantedFits) down = otherFits ? !down : roomBelow >= roomAbove

  const maxHeight = Math.min(want, Math.max(0, down ? roomBelow : roomAbove))
  return {
    left: Math.min(Math.max(EDGE, anchor.left), viewport.width - popWidth - EDGE),
    top: down ? anchor.bottom + GAP : anchor.top - GAP - maxHeight,
    width: anchor.width,
    maxHeight,
    visible: anchor.bottom > clip.top && anchor.top < clip.bottom
  }
}

/**
 * Measures `anchorRef` and returns where `popRef` should sit. Null until the
 * first measurement, so render the popover hidden while it is.
 *
 * Re-measures on scroll and resize rather than dismissing: reaching for a list
 * the pane has pushed out of view is the commonest thing to do with one.
 *
 * @param deps anything that changes the popover's own height — a filtered
 *   list, a section that appears — so it is placed again before paint.
 */
export function useAnchoredPop(
  anchorRef: React.RefObject<HTMLElement>,
  popRef: React.RefObject<HTMLElement>,
  { placement = 'down', deps = [] }: { placement?: 'down' | 'up'; deps?: unknown[] } = {}
): PopBox | null {
  const [box, setBox] = useState<PopBox | null>(null)
  const boxRef = useRef<PopBox | null>(null)

  const place = useCallback((): void => {
    const a = anchorRef.current
    const pop = popRef.current
    if (!a || !pop) return

    const r = a.getBoundingClientRect()
    const clip = clipRect(a)

    // Measure at the height the popover WANTS. Clearing the inline cap falls
    // back to the language's own max-height, so `want` is already the smaller
    // of the content and that cap — and measuring the constrained box instead
    // would make a flip stick once it happened.
    //
    // The width has to be pinned to the trigger first. .axi-picker__pop says
    // `min-width: 100%` so a list is never narrower than the box it came out
    // of — but that percentage resolves against the containing block, and for
    // a fixed popover the containing block is the viewport. Measured before
    // the first render has put an inline minWidth on it, the list comes back
    // as wide as the window, and the right-edge clamp throws it to x ≈ 0.
    const capped = pop.style.maxHeight
    const minned = pop.style.minWidth
    pop.style.minWidth = `${r.width}px`
    pop.style.maxHeight = ''
    const want = pop.offsetHeight
    const w = pop.offsetWidth
    pop.style.maxHeight = capped
    pop.style.minWidth = minned

    const next = placeAnchored({
      anchor: r,
      clip,
      want,
      popWidth: w,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      placement
    })
    if (same(boxRef.current, next)) return
    boxRef.current = next
    setBox(next)
  }, [anchorRef, popRef, placement])

  // Before paint, so the popover never lands twice.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(place, [place, ...deps])

  useEffect(() => {
    // `true` because the pane that scrolls is an ancestor of the trigger, not
    // of the popover — it never sees a bubbling scroll event.
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [place])

  return box
}
