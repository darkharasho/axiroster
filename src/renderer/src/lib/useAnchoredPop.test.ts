import { describe, it, expect } from 'vitest'
import { placeAnchored } from './useAnchoredPop'

const VIEWPORT = { width: 1200, height: 800 }
/** No clipping ancestor: the trigger is visible wherever the viewport is. */
const OPEN = { top: 0, bottom: 800 }

function at(top: number, opts: Partial<Parameters<typeof placeAnchored>[0]> = {}) {
  return placeAnchored({
    anchor: { top, bottom: top + 32, left: 100, width: 220 },
    clip: OPEN,
    want: 340,
    popWidth: 260,
    viewport: VIEWPORT,
    ...opts
  })
}

describe('placeAnchored', () => {
  it('sits under a trigger with room below', () => {
    const box = at(100)
    expect(box.top).toBe(141) // 100 + 32 + the 9px offset block
    expect(box.maxHeight).toBe(340)
  })

  it('flips above a trigger low in the viewport rather than running off-screen', () => {
    // The reported bug: a 340px list under a trigger at y=600 ends at y=981,
    // 181px past the bottom of an 800px window.
    const box = at(600)
    expect(box.top).toBe(251) // 600 - 9 - 340
    expect(box.top + box.maxHeight).toBeLessThanOrEqual(VIEWPORT.height)
  })

  it('shrinks to the roomier side when neither side fits', () => {
    const box = at(360) // 351px above, 401px below — but want is 340 + edges
    expect(box.top + box.maxHeight).toBeLessThanOrEqual(VIEWPORT.height - 8)
    expect(box.maxHeight).toBeGreaterThan(0)
  })

  it('never lets a short popover leave the viewport either way', () => {
    for (let top = 0; top <= 768; top += 8) {
      const box = at(top, { want: 120 })
      expect(box.top).toBeGreaterThanOrEqual(8)
      expect(box.top + box.maxHeight).toBeLessThanOrEqual(VIEWPORT.height - 8)
    }
  })

  it('honours a requested side while it fits, and abandons it when it does not', () => {
    expect(at(600, { placement: 'up' }).top).toBe(251)
    // Nothing above to open into, so "up" gives way rather than clipping.
    expect(at(20, { placement: 'up' }).top).toBe(61)
  })

  it('keeps a wide popover clear of the right edge', () => {
    const box = placeAnchored({
      anchor: { top: 100, bottom: 132, left: 1150, width: 40 },
      clip: OPEN,
      want: 200,
      popWidth: 260,
      viewport: VIEWPORT
    })
    expect(box.left).toBe(1200 - 260 - 8)
  })

  it('reports the trigger hidden once its pane has scrolled it away', () => {
    const pane = { top: 200, bottom: 600 }
    expect(placeAnchored({ ...arg(300), clip: pane }).visible).toBe(true)
    expect(placeAnchored({ ...arg(150), clip: pane }).visible).toBe(false)
    expect(placeAnchored({ ...arg(650), clip: pane }).visible).toBe(false)
  })

  it('still reports the width of its trigger, which the list may not go under', () => {
    expect(at(100).width).toBe(220)
  })
})

function arg(top: number): Parameters<typeof placeAnchored>[0] {
  return {
    anchor: { top, bottom: top + 32, left: 100, width: 220 },
    clip: OPEN,
    want: 200,
    popWidth: 260,
    viewport: VIEWPORT
  }
}
