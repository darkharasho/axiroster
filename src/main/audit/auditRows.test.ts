import { test, expect } from 'vitest'
import { eventToRow, rowToEvent, cursorsToRow, rowToCursors } from './auditRows'
import type { AuditEvent } from '../auditNormalize'

const ev: AuditEvent = {
  uid: 'gw2:42', source: 'gw2', id: '42', time: '2026-06-20T10:00:00.000Z',
  type: 'joined', actor: 'Alice.1234', target: '', summary: 'Alice joined', raw: { x: 1 }
}

test('eventToRow extracts indexed columns + full payload', () => {
  expect(eventToRow('WS1', ev)).toEqual({
    workspace_id: 'WS1', uid: 'gw2:42', source: 'gw2', type: 'joined',
    actor: 'Alice.1234', target: '', summary: 'Alice joined',
    ts: '2026-06-20T10:00:00.000Z', payload: ev
  })
})

test('rowToEvent prefers the stored payload', () => {
  const row = eventToRow('WS1', ev)
  expect(rowToEvent(row)).toEqual(ev)
})

test('rowToEvent falls back to columns when payload is absent', () => {
  expect(rowToEvent({ uid: 'gw2:7', source: 'gw2', type: 't', actor: 'A', target: '', summary: 's', ts: '2026-06-20T10:00:00.000Z' }))
    .toEqual({ uid: 'gw2:7', source: 'gw2', id: '7', time: '2026-06-20T10:00:00.000Z', type: 't', actor: 'A', target: '', summary: 's', raw: null })
})

test('cursor round-trip', () => {
  expect(rowToCursors(cursorsToRow('WS1', { gw2LastLogId: 99, discordLastId: '5' })))
    .toEqual({ gw2LastLogId: 99, discordLastId: '5' })
})
