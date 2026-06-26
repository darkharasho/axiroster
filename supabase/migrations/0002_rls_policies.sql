-- supabase/migrations/0002_rls_policies.sql
alter table workspaces        enable row level security;
alter table workspace_secrets enable row level security;
alter table workspace_members enable row level security;
alter table workspace_invites enable row level security;
alter table roster_members    enable row level security;
alter table roster_annotations enable row level security;
alter table roster_links       enable row level security;

-- Membership predicates as helper functions (security definer to read members
-- without recursive RLS).
create or replace function is_member(ws text) returns boolean
  language sql security definer set search_path = public stable as $$
  select exists (select 1 from workspace_members m
                 where m.workspace_id = ws and m.user_id = auth.uid());
$$;

create or replace function can_write(ws text) returns boolean
  language sql security definer set search_path = public stable as $$
  select exists (select 1 from workspace_members m
                 where m.workspace_id = ws and m.user_id = auth.uid()
                   and m.role in ('owner','write'));
$$;

create or replace function is_owner(ws text) returns boolean
  language sql security definer set search_path = public stable as $$
  select exists (select 1 from workspace_members m
                 where m.workspace_id = ws and m.user_id = auth.uid()
                   and m.role = 'owner');
$$;

-- workspaces: members read; no client writes (Edge Functions use service role).
create policy ws_select on workspaces for select using (is_member(workspace_id));

-- workspace_secrets: no client access whatsoever.
-- (RLS on with zero policies = deny all for anon/authenticated.)

-- workspace_members: members can see the roster of members; owner manages.
create policy wm_select on workspace_members for select using (is_member(workspace_id));
create policy wm_insert on workspace_members for insert with check (is_owner(workspace_id));
create policy wm_update on workspace_members for update using (is_owner(workspace_id));
create policy wm_delete on workspace_members for delete using (is_owner(workspace_id));

-- workspace_invites: owner only (redemption goes through Edge Function).
create policy wi_all on workspace_invites for all
  using (is_owner(workspace_id)) with check (is_owner(workspace_id));

-- roster_members: members read; no client writes (refresh-roster writes).
create policy rm_select on roster_members for select using (is_member(workspace_id));

-- roster_annotations: members read, write+ mutate.
create policy ra_select on roster_annotations for select using (is_member(workspace_id));
create policy ra_write on roster_annotations for all
  using (can_write(workspace_id)) with check (can_write(workspace_id));

-- roster_links: members read, write+ mutate.
create policy rl_select on roster_links for select using (is_member(workspace_id));
create policy rl_write on roster_links for all
  using (can_write(workspace_id)) with check (can_write(workspace_id));
