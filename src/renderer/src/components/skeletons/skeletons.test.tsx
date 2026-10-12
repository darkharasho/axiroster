// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import TabSkeleton, { type GuildTab } from './TabSkeleton'

afterEach(cleanup)

const CASES: [GuildTab, string, number][] = [
  // tab, label, rows (tbody tr / log rows / cards / fields)
  ['roster', 'Loading roster…', 8],
  ['departed', 'Loading departures…', 6],
  ['log', 'Loading log…', 8],
  ['retention', 'Loading retention…', 8],
  ['recruitment', 'Loading recruitment…', 0],
  ['sharing', 'Loading sharing…', 0],
  ['settings', 'Loading settings…', 0]
]

describe('skeletons', () => {
  it.each(CASES)('%s is busy, labelled, and draws a fixed row count', (tab, label, rows) => {
    const { container } = render(<TabSkeleton tab={tab} />)
    const root = container.firstElementChild as HTMLElement
    expect(root.getAttribute('aria-busy')).toBe('true')
    expect(root.getAttribute('aria-label')).toBe(label)
    expect(container.querySelectorAll('.axi-skeleton').length).toBeGreaterThan(0)
    if (tab === 'log') expect(container.querySelectorAll('.ar-log__row')).toHaveLength(rows)
    else if (rows) expect(container.querySelectorAll('tbody tr')).toHaveLength(rows)
  })

  it.each(CASES)('%s renders identically twice (no randomness)', (tab) => {
    const a = render(<TabSkeleton tab={tab} />).container.innerHTML
    cleanup()
    const b = render(<TabSkeleton tab={tab} />).container.innerHTML
    expect(b).toBe(a)
  })

  it('every control a skeleton draws is disabled', () => {
    for (const [tab] of CASES) {
      const { container } = render(<TabSkeleton tab={tab} />)
      for (const el of container.querySelectorAll('button, input')) {
        expect((el as HTMLButtonElement).disabled, `${tab}: ${el.outerHTML}`).toBe(true)
      }
      cleanup()
    }
  })

  it('the roster skeleton keeps the real table head', () => {
    const { container } = render(<TabSkeleton tab="roster" />)
    const heads = [...container.querySelectorAll('thead th')].map((th) => th.textContent)
    expect(heads).toEqual(['', 'Member', 'Profession', 'Rank', 'Joined', 'Attendance', 'Last seen'])
  })
})
