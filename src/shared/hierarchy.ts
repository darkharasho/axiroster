// src/shared/hierarchy.ts
// The Discord role-hierarchy guard lives with the edge functions (they can't
// import src/); desktop uses it through this re-export.
export * from '../../supabase/functions/_shared/hierarchy'
export { discordIdFromUser } from '../../supabase/functions/_shared/identity'
