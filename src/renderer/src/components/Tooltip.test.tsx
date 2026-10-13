// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import Tooltip from './Tooltip'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect
}

// jsdom has no layout: the trigger and the tooltip report the boxes given here.
function hoverAt(trigger: DOMRect, tipWidth: number, tipHeight = 24): HTMLElement {
  vi.useFakeTimers()
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (!this.classList.contains('axi-tooltip')) return trigger
    const left = parseFloat(this.style.left)
    const top = parseFloat(this.style.top)
    const below = this.style.transform === 'translate(-50%, 0)'
    return rect(left - tipWidth / 2, below ? top : top - tipHeight, tipWidth, tipHeight)
  })
  const { container } = render(
    <Tooltip text="Remove member role">
      <button>x</button>
    </Tooltip>
  )
  fireEvent.mouseEnter(container.firstElementChild as Element)
  act(() => vi.advanceTimersByTime(500))
  return document.querySelector('.axi-tooltip') as HTMLElement
}

describe('Tooltip', () => {
  it('slides left to stay inside the right edge of the window', () => {
    window.innerWidth = 1000
    const tip = hoverAt(rect(980, 300, 20, 20), 160)
    // centred on 990 it would end at 1070; it must end at 1000 - 8
    expect(parseFloat(tip.style.left) + 80).toBe(992)
  })

  it('slides right to stay inside the left edge', () => {
    window.innerWidth = 1000
    const tip = hoverAt(rect(0, 300, 20, 20), 160)
    expect(parseFloat(tip.style.left) - 80).toBe(8)
  })

  it('flips below its trigger when there is no room above', () => {
    window.innerWidth = 1000
    const tip = hoverAt(rect(500, 2, 20, 20), 100)
    expect(tip.style.top).toBe('28px')
    expect(tip.style.transform).toBe('translate(-50%, 0)')
  })

  it('stays centred above its trigger when it fits', () => {
    window.innerWidth = 1000
    const tip = hoverAt(rect(500, 300, 20, 20), 100)
    expect(tip.style.left).toBe('510px')
    expect(tip.style.top).toBe('294px')
  })
})
