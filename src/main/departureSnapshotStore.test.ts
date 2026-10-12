import { test, expect } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { DepartureSnapshotStore } from './departureSnapshotStore'

const dir = (): string => mkdtempSync(join(tmpdir(), 'dep-snap-'))

test('no file yet → null (no snapshot)', () => {
  expect(new DepartureSnapshotStore(dir()).read('g1')).toBeNull()
})

test('write → read round-trips', () => {
  const s = new DepartureSnapshotStore(dir())
  s.write('g1', ['A.1', 'B.2'])
  expect(s.read('g1')).toEqual(['A.1', 'B.2'])
})

test('guilds are isolated', () => {
  const s = new DepartureSnapshotStore(dir())
  s.write('g1', ['A.1'])
  s.write('g2', ['Z.9'])
  expect(s.read('g1')).toEqual(['A.1'])
  expect(s.read('g2')).toEqual(['Z.9'])
})

test('a corrupt file reads as null', () => {
  const d = dir()
  mkdirSync(d, { recursive: true })
  writeFileSync(join(d, 'g1.json'), '{nope')
  expect(new DepartureSnapshotStore(d).read('g1')).toBeNull()
})
