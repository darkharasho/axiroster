// src/shared/departures.ts
// The departures core lives with the edge functions (they can't import src/);
// desktop and web use it through this re-export.
export * from '../../supabase/functions/_shared/departures'
