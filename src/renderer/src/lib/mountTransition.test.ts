import { describe, expect, it } from 'vitest'
import {
  isMounted,
  isShown,
  nextOnExitEnd,
  nextOnFrame,
  nextOnOpenChange,
  type MountPhase
} from './mountTransition'

describe('mountTransition', () => {
  it('mounts in the pre-enter phase when opened, so the enter styles can animate', () => {
    expect(nextOnOpenChange('closed', true)).toBe('entering')
    expect(isMounted('entering')).toBe(true)
    // Still at the "from" styles — the frame tick is what flips it.
    expect(isShown('entering')).toBe(false)
  })

  it('settles to open on the next frame', () => {
    expect(nextOnFrame('entering')).toBe('open')
    expect(isShown('open')).toBe(true)
  })

  it('stays mounted while leaving so the exit animation is visible', () => {
    expect(nextOnOpenChange('open', false)).toBe('leaving')
    expect(isMounted('leaving')).toBe(true)
    expect(isShown('leaving')).toBe(false)
  })

  it('unmounts only once the exit duration has elapsed', () => {
    expect(nextOnExitEnd('leaving')).toBe('closed')
    expect(isMounted('closed')).toBe(false)
  })

  it('reopening mid-exit returns straight to open without remounting', () => {
    expect(nextOnOpenChange('leaving', true)).toBe('open')
  })

  it('closing mid-enter goes to leaving', () => {
    expect(nextOnOpenChange('entering', false)).toBe('leaving')
  })

  it('leaves unrelated phases untouched for each tick', () => {
    const all: MountPhase[] = ['closed', 'entering', 'open', 'leaving']
    for (const p of all) {
      if (p !== 'entering') expect(nextOnFrame(p)).toBe(p)
      if (p !== 'leaving') expect(nextOnExitEnd(p)).toBe(p)
    }
    // Re-asserting the current state is a no-op in both directions.
    expect(nextOnOpenChange('open', true)).toBe('open')
    expect(nextOnOpenChange('closed', false)).toBe('closed')
  })
})
