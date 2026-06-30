import { describe, it, expect } from 'vitest'
import { mergeSharedFlags } from './sharedFlags'

describe('mergeSharedFlags', () => {
  it('takes the workspace value when present', () => {
    expect(mergeSharedFlags({ retentionEnabled: true, pipelineEnabled: false }, undefined)).toEqual({
      retentionEnabled: true,
      pipelineEnabled: false
    })
  })

  it('defaults retention=false and pipeline=true when nothing is provided', () => {
    expect(mergeSharedFlags({}, undefined)).toEqual({ retentionEnabled: false, pipelineEnabled: true })
  })

  it('falls back to the existing local profile when the workspace omits a flag', () => {
    expect(
      mergeSharedFlags({}, { retentionEnabled: true, pipelineEnabled: false })
    ).toEqual({ retentionEnabled: true, pipelineEnabled: false })
  })

  it('workspace value overrides the existing local value', () => {
    expect(
      mergeSharedFlags({ retentionEnabled: false, pipelineEnabled: true }, { retentionEnabled: true, pipelineEnabled: false })
    ).toEqual({ retentionEnabled: false, pipelineEnabled: true })
  })
})
