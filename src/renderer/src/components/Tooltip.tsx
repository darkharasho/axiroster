import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

interface TooltipProps {
  text: string
  children: React.ReactElement
  delay?: number
  position?: 'top' | 'bottom' | 'right'
  className?: string
}

/**
 * A hover label drawn with the package's .axi-tooltip.
 *
 * The portal to <body> is the class's contract, not a convenience: every
 * hovered thing in this language is transformed by its lift, and a transformed
 * ancestor re-anchors a position:fixed child to itself — a tooltip rendered
 * inside the element it annotates would jump the first time that element
 * lifted. It also never carries information that exists nowhere else, because
 * a keyboard or touch user may never see it.
 */
export default function Tooltip({
  text,
  children,
  delay = 400,
  position = 'top',
  className = 'inline-flex'
}: TooltipProps): JSX.Element {
  const [visible, setVisible] = useState(false)
  const [coords, setCoords] = useState({ x: 0, y: 0 })
  const timerRef = useRef<number | null>(null)
  const triggerRef = useRef<HTMLDivElement>(null)

  const show = (): void => {
    timerRef.current = window.setTimeout(() => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (rect) {
        setCoords(
          position === 'right'
            ? { x: rect.right, y: rect.top + rect.height / 2 }
            : { x: rect.left + rect.width / 2, y: position === 'top' ? rect.top : rect.bottom }
        )
      }
      setVisible(true)
    }, delay)
  }

  const hide = (): void => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setVisible(false)
  }

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    }
  }, [])

  if (!text) return children

  return (
    <div
      ref={triggerRef}
      onMouseEnter={show}
      onMouseLeave={hide}
      onMouseDown={hide}
      className={className}
    >
      {/* The native title is stripped: two hover labels for one control is the
          OS drawing over the language, and the OS one wins on delay. */}
      {React.cloneElement(children, { title: undefined })}
      {visible &&
        createPortal(
          <div
            className="axi-tooltip"
            style={{
              left: position === 'right' ? coords.x + 8 : coords.x,
              top: position === 'right' ? coords.y : position === 'top' ? coords.y - 6 : coords.y + 6,
              transform:
                position === 'right'
                  ? 'translate(0, -50%)'
                  : position === 'top'
                    ? 'translate(-50%, -100%)'
                    : 'translate(-50%, 0)'
            }}
          >
            {text}
          </div>,
          document.body
        )}
    </div>
  )
}
