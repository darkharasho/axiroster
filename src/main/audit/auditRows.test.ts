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

test('rowToEvent rejects incomplete payload, reconstructs from columns', () => {
  // Payload with only uid is incomplete; should reconstruct from columns
  const row = {
    uid: 'discord:123',
    source: 'discord',
    type: 'member_kick',
    actor: 'Officer.1',
    target: 'Target.2',
    summary: 'Officer kicked Target',
    ts: '2026-06-21T12:00:00.000Z',
    payload: { uid: 'discord:123' } // incomplete: missing source, time, summary
  }
  const result = rowToEvent(row)
  expect(result).toEqual({
    uid: 'discord:123',
    source: 'discord', // from column
    id: '123',
    time: '2026-06-21T12:00:00.000Z', // from column
    type: 'member_kick',
    actor: 'Officer.1',
    target: 'Target.2',
    summary: 'Officer kicked Target', // from column
    raw: null
  })
})

test('cursor round-trip', () => {
  expect(rowToCursors(cursorsToRow('WS1', { gw2LastLogId: 99, discordLastId: '5' })))
    .toEqual({ gw2LastLogId: 99, discordLastId: '5' })
})
