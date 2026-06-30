// src/main/sharedFlags.ts
// Resolve the synced feature flags (retention/pipeline) for a member adopting a
// shared guild. The workspace value (from get-shared-keys) is authoritative; if it
// omits a flag we keep the existing local value, then fall back to the type default
// (retention opt-in => false, pipeline opt-out => true).

export interface SharedFlagSource {
  retentionEnabled?: boolean | null
  pipelineEnabled?: boolean | null
}

export interface ResolvedFlags {
  retentionEnabled: boolean
  pipelineEnabled: boolean
}

export function mergeSharedFlags(shared: SharedFlagSource, existing?: SharedFlagSource): ResolvedFlags {
  const retentionEnabled =
    typeof shared.retentionEnabled === 'boolean'
      ? shared.retentionEnabled
      : typeof existing?.retentionEnabled === 'boolean'
        ? existing.retentionEnabled
        : false
  const pipelineEnabled =
    typeof shared.pipelineEnabled === 'boolean'
      ? shared.pipelineEnabled
      : typeof existing?.pipelineEnabled === 'boolean'
        ? existing.pipelineEnabled
        : true
  return { retentionEnabled, pipelineEnabled }
}
