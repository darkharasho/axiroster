-- Persist each member's Discord username + display (global) name on their
-- membership row, so the member-management panel can show real names without
-- depending on the AxiTools bot roster (which is fragile and was leaving raw
-- Discord ids on screen). Populated by the stamp-identity edge function, which
-- reads the trustworthy auth.identities record (never user_metadata).

alter table workspace_members
  add column if not exists discord_username    text,
  add column if not exists discord_global_name text;
