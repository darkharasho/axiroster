// src/renderer/src/lib/useMountTransition.ts
//
// Keeps a subtree mounted long enough to play its exit animation. Thin React
// wrapper — all the phase logic lives in the node-tested mountTransition.ts.

import { useEffect, useRef, useState } from 'react'
import {
  isMounted,
  isShown,
  nextOnExitEnd,
  nextOnFrame,
  nextOnOpenChange,
  type MountPhase
} from './mountTransition'

export interface MountTransition {
  /** Render the subtree at all? */
  mounted: boolean
  /** Apply the visible ("to") styles? */
  shown: boolean
}

export function useMountTransition(open: boolean, exitMs = 150): MountTransition {
  const [phase, setPhase] = useState<MountPhase>(open ? 'open' : 'closed')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setPhase((p) => nextOnOpenChange(p, open))
  }, [open])

  useEffect(() => {
    if (phase === 'entering') {
      // Two frames: one to get the "from" styles painted, one to flip to "to"
      // so the browser has something to interpolate from.
      const raf = requestAnimationFrame(() => requestAnimationFrame(() => setPhase(nextOnFrame)))
      return () => cancelAnimationFrame(raf)
    }
    if (phase === 'leaving') {
      timer.current = setTimeout(() => setPhase(nextOnExitEnd), exitMs)
      return () => {
        if (timer.current) clearTimeout(timer.current)
      }
    }
    return undefined
  }, [phase, exitMs])

  return { mounted: isMounted(phase), shown: isShown(phase) }
}
