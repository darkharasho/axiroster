import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export interface PickerOption {
  value: string
  label: string
}

/**
 * A drop-in replacement for `<select className="axi-select">`, drawn with the
 * package's .axi-picker.
 *
 * The native select keeps its closed box but hands its popup to the OS unless
 * the browser has `appearance: base-select` — and Electron 33 is Chromium 130,
 * which does not. What the desktop app got was an OS list: no ink outline, no
 * offset block, and the system's own blue on the highlighted row where the
 * accent belongs. That is rule 3 broken by a box the language cannot reach,
 * so the list is ours now.
 *
 * The popover is portaled to <body> and positioned from a measurement, which
 * is .axi-picker__pop--fixed's contract. Two reasons, both fatal to an
 * in-place absolute popover here: these pickers sit inside panes that scroll,
 * which would clip the list and eat the offset block that falls outside its
 * box; and every hover lift in this language is a transform, which re-anchors
 * a fixed child to the lifted ancestor. Same reasoning as Tooltip.
 */
export default function Picker({
  value,
  onChange,
  options,
  className = '',
  disabled = false,
  title,
  sm = false,
  autoOpen = false,
  onDismiss
}: {
  value: string
  onChange: (value: string) => void
  options: PickerOption[]
  className?: string
  disabled?: boolean
  title?: string
  /** The .ar-sm scale. Applied to the popover too, since it is portaled out. */
  sm?: boolean
  /** Open on mount — for a picker that IS the transient UI, not a control
      sitting in a strip waiting to be clicked. */
  autoOpen?: boolean
  /** Called whenever the popover closes, chosen or not. */
  onDismiss?: () => void
}): JSX.Element {
  const [open, setOpen] = useState(autoOpen)
  const [box, setBox] = useState({ left: 0, top: 0, width: 0 })
  const rootRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  const current = options.find((o) => o.value === value)

  const place = (): void => {
    const r = btnRef.current?.getBoundingClientRect()
    if (r) setBox({ left: r.left, top: r.bottom + 9, width: r.width })
  }

  const openPop = (): void => {
    place()
    setOpen(true)
  }

  const close = (focusTrigger: boolean): void => {
    setOpen(false)
    if (focusTrigger) btnRef.current?.focus()
    onDismiss?.()
  }

  const choose = (v: string): void => {
    onChange(v)
    close(true)
  }

  // Opening lands focus on the current choice, not the top of the list: the
  // first arrow press should step away from where you already are.
  useLayoutEffect(() => {
    if (autoOpen) place()
  }, [])

  useLayoutEffect(() => {
    if (!open) return
    const pop = popRef.current
    if (!pop) return
    const opts = [...pop.querySelectorAll<HTMLButtonElement>('.axi-picker__opt')]
    const i = options.findIndex((o) => o.value === value)
    ;(opts[i >= 0 ? i : 0] ?? pop).focus()
    // A list taller than its box opens with the choice out of sight otherwise.
    opts[i >= 0 ? i : 0]?.scrollIntoView({ block: 'nearest' })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (rootRef.current?.contains(t) || popRef.current?.contains(t)) return
      close(false)
    }
    // The popover is measured once, so anything that moves the trigger under
    // it has to dismiss it rather than leave a list floating off its control.
    const onMove = (): void => close(false)
    document.addEventListener('mousedown', onDown)
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('resize', onMove)
      window.removeEventListener('scroll', onMove, true)
    }
  }, [open])

  const onPopKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      close(true)
      return
    }
    const opts = [...(popRef.current?.querySelectorAll<HTMLButtonElement>('.axi-picker__opt') ?? [])]
    const i = opts.indexOf(document.activeElement as HTMLButtonElement)
    if (i < 0) return
    const to =
      e.key === 'ArrowDown'
        ? Math.min(i + 1, opts.length - 1)
        : e.key === 'ArrowUp'
          ? Math.max(i - 1, 0)
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? opts.length - 1
              : null
    if (to === null) return
    e.preventDefault()
    opts[to].focus()
  }

  return (
    <div ref={rootRef} className={`axi-picker ${className}`.trim()}>
      <button
        ref={btnRef}
        type="button"
        title={title}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? close(false) : openPop())}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            openPop()
          }
        }}
        className={`axi-picker__btn${sm ? ' ar-sm' : ''}`}
      >
        <span className="truncate">{current?.label ?? ''}</span>
      </button>
      {open &&
        createPortal(
          <div
            ref={popRef}
            role="listbox"
            tabIndex={-1}
            onKeyDown={onPopKeyDown}
            className={`axi-picker__pop axi-picker__pop--fixed${sm ? ' ar-sm' : ''}`}
            style={{ left: box.left, top: box.top, minWidth: box.width }}
          >
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={o.value === value}
                onClick={() => choose(o.value)}
                className={`axi-picker__opt${sm ? ' ar-sm' : ''}`}
              >
                {o.label}
              </button>
            ))}
          </div>,
          document.body
        )}
    </div>
  )
}
