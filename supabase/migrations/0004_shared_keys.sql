-- Opt-in key sharing: an owner can share the guild's GW2 + AxiTools keys with the
-- whole workspace so keyless invited officers get full features. The AxiTools key
-- joins the GW2 leader key in workspace_secrets (deny-all RLS — edge functions
-- only). Non-secret guild metadata + the shared flag live on workspaces.
alter table workspace_secrets add column if not exists axitools_key_enc text;

alter table workspaces
  add column if not exists keys_shared boolean default false,
  add column if not exists discord_guild_name text default '';
