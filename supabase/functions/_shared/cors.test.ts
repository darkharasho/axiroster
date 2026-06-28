import { test, expect } from 'vitest'
import { preflight } from './cors.ts'

test('preflight returns CORS response for OPTIONS', () => {
  const req = new Request('http://x', { method: 'OPTIONS' })
  const res = preflight(req)
  expect(res).not.toBeNull()
  expect(res!.headers.get('Access-Control-Allow-Origin')).toBe('*')
})

test('preflight returns null for POST', () => {
  const req = new Request('http://x', { method: 'POST' })
  const res = preflight(req)
  expect(res).toBeNull()
})
