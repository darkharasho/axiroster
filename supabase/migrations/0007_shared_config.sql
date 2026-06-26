-- Shared workspace config beyond keys: the Discord member-role anchor and the
-- AxiBridge report repos live on the workspace so the whole guild shares them.
alter table workspaces
  add column if not exists member_role_id text default '',
  add column if not exists bridge_repos jsonb default '[]'::jsonb;

-- write+ members may edit the shared config (read members cannot). Keys stay in
-- workspace_secrets (deny-all), so this only exposes the non-secret config row.
create policy ws_update_write on workspaces
  for update using (can_write(workspace_id)) with check (can_write(workspace_id));
