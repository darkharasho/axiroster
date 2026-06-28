// src/renderer/src/lib/clientSeam.guard.test.ts
// Guards the data-layer seam: after Phase 2a, window.axiroster may be referenced
// only in main.tsx (the single install point). Any other reference means a
// component bypassed the injectable client and would break the web build.
import { test, expect } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'

const SRC = join(process.cwd(), 'src/renderer/src')
// Build the needle at runtime so this guard file does not match itself.
const NEEDLE = ['window', 'axiroster'].join('.')
const ALLOWED = ['main.tsx', 'clientSeam.guard.test.ts'] // install point + this guard file (test name contains the needle)

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(p))
    else if (/\.tsx?$/.test(entry.name)) out.push(p)
  }
  return out
}

test('window.axiroster is referenced only in main.tsx (seam intact)', () => {
  const offenders = walk(SRC).filter((p) => {
    if (ALLOWED.some((a) => p.endsWith(a))) return false
    return readFileSync(p, 'utf8').includes(NEEDLE)
  })
  expect(offenders).toEqual([])
})
