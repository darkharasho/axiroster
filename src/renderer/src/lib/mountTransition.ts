// src/renderer/src/lib/mountTransition.ts
//
// Pure phase machine behind useMountTransition. Keeping it free of React/DOM
// makes the tricky part — staying mounted through the exit animation, and
// surviving an open/close flip mid-animation — node-testable, the same way
// lib/attendanceWindow.ts splits from its component.

export type MountPhase =
  | 'closed' // not rendered
  | 'entering' // rendered, still at the "from" styles
  | 'open' // rendered, at the "to" styles
  | 'leaving' // rendered, animating back out

/** Phase after the `open` flag changes. */
export function nextOnOpenChange(phase: MountPhase, open: boolean): MountPhase {
  if (open) {
    // Mid-exit the node is still mounted, so it can transition straight back
    // in — remounting would restart from the "from" styles and look like a pop.
    if (phase === 'leaving') return 'open'
    return phase === 'closed' ? 'entering' : phase
  }
  return phase === 'closed' ? 'closed' : 'leaving'
}

/** Phase after the frame that follows mounting — flips on the enter styles. */
export function nextOnFrame(phase: MountPhase): MountPhase {
  return phase === 'entering' ? 'open' : phase
}

/** Phase once the exit duration has elapsed. */
export function nextOnExitEnd(phase: MountPhase): MountPhase {
  return phase === 'leaving' ? 'closed' : phase
}

/** Whether the subtree should be rendered at all. */
export function isMounted(phase: MountPhase): boolean {
  return phase !== 'closed'
}

/** Whether it should carry its visible ("to") styles. */
export function isShown(phase: MountPhase): boolean {
  return phase === 'open'
}
