import { test, expect } from 'vitest'
import { saveOutcome } from './GuildSettings'

test('null result → error outcome, do not finish', () => {
  expect(saveOutcome(null)).toEqual({
    ok: false,
    message: "Couldn't add guild — check you're a GW2 guild leader and the keys are valid.",
    variant: 'error'
  })
})

test('summary result → success outcome', () => {
  expect(saveOutcome({ id: 'g1' } as never)).toEqual({ ok: true, message: 'Guild added', variant: 'success' })
})
