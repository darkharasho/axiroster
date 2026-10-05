-- supabase/migrations/0012_access_policy.sql
-- Axi access policy. Access to the Axi apps can be revoked for people, GW2
-- guilds and Discord servers that violate their terms of use. The axi-config
-- Worker (config.axi.link) pushes the active list here as SHA-256 hashes of
-- "kind:normalized" identifiers via replace_policy_blocks(); nothing here
-- names anyone. The membership predicates used by every RLS policy now also
-- require that neither the caller nor the workspace is on the list, so a
-- revocation takes effect on existing data immediately. wm_self_leave does not
-- use them, so a blocked user can still leave a workspace.

create table if not exists policy_blocks (
  hash text primary key check (hash ~ '^[0-9a-f]{64}$')
);

create table if not exists policy_state (
  id      boolean primary key default true check (id),
  version bigint  not null default 0
);
insert into policy_state (id, version) values (true, 0) on conflict (id) do nothing;

-- Service role only: RLS on with no policies, and no table privileges.
alter table policy_blocks enable row level security;
alter table policy_state  enable row level security;
revoke all on policy_blocks, policy_state from anon, authenticated;
grant select, insert, update, delete on policy_blocks, policy_state to service_role;

-- SQL port of the axi-config identity hash for the stored identifiers used
-- below (snowflakes and guild UUIDs): NFC, trim, lowercase, NFC, then
-- sha256_hex(kind || ':' || normalized). NULL for a NULL or blank value.
-- The trim strips exactly what JS String.prototype.trim strips (ECMAScript
-- WhiteSpace + LineTerminator), not just spaces as btrim does.
create or replace function policy_hash(kind text, value text) returns text
  language sql immutable set search_path = public as $$
  select case
    when trimmed is null or trimmed = '' then null
    else encode(sha256(convert_to(kind || ':' || normalize(lower(trimmed), nfc), 'UTF8')), 'hex')
  end
  from (select regexp_replace(normalize(value, nfc),
    '^[\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+|[\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+$',
    '', 'g') as trimmed) t;
$$;

create or replace function is_blocked(hashes text[]) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from policy_blocks b where b.hash = any (hashes));
$$;

-- True when the calling user, or the workspace itself, is on the list: the
-- workspace's GW2 guild (its id) and linked Discord server, and the caller's
-- Discord id from their auth identity or their member row. With an empty list
-- (the dormant state) no hash is computed at all.
create or replace function caller_blocked(ws text) returns boolean
  language sql stable security definer set search_path = public as $$
  select case
    when not exists (select 1 from policy_blocks) then false
    else is_blocked(array[
      policy_hash('gw2_guild', ws),
      (select policy_hash('discord_server', w.discord_guild_id)
         from workspaces w where w.workspace_id = ws),
      (select policy_hash('discord_user', i.provider_id)
         from auth.identities i
        where i.user_id = auth.uid() and i.provider = 'discord'
        limit 1),
      (select policy_hash('discord_user', m.discord_id)
         from workspace_members m
        where m.workspace_id = ws and m.user_id = auth.uid())
    ])
  end;
$$;

-- Internal helpers: clients must not be able to probe the list through them.
-- The membership predicates below are security definer, so they still reach them.
revoke execute on function is_blocked(text[]) from public, anon, authenticated;
revoke execute on function caller_blocked(text) from public, anon, authenticated;

create or replace function is_member(ws text) returns boolean
  language sql security definer set search_path = public stable as $$
  select exists (select 1 from workspace_members m
                 where m.workspace_id = ws and m.user_id = auth.uid())
     and not caller_blocked(ws);
$$;

create or replace function can_write(ws text) returns boolean
  language sql security definer set search_path = public stable as $$
  select exists (select 1 from workspace_members m
                 where m.workspace_id = ws and m.user_id = auth.uid()
                   and m.role in ('owner','write'))
     and not caller_blocked(ws);
$$;

create or replace function is_owner(ws text) returns boolean
  language sql security definer set search_path = public stable as $$
  select exists (select 1 from workspace_members m
                 where m.workspace_id = ws and m.user_id = auth.uid()
                   and m.role = 'owner')
     and not caller_blocked(ws);
$$;

-- Called by the axi-config Worker with the service key after every list
-- change (and by its 10-minute retry). Pushes can arrive out of order; one
-- older than the last applied version is ignored. Returns false when ignored.
create or replace function replace_policy_blocks(p_hashes text[], p_version bigint) returns boolean
  language plpgsql security definer set search_path = public as $$
declare
  current_version bigint;
begin
  select version into current_version from policy_state where id for update;
  if p_version < current_version then
    return false;
  end if;
  delete from policy_blocks where true;
  insert into policy_blocks (hash)
    select distinct h from unnest(coalesce(p_hashes, '{}'::text[])) as h
     where h ~ '^[0-9a-f]{64}$';
  update policy_state set version = p_version where id;
  return true;
end;
$$;

revoke execute on function replace_policy_blocks(text[], bigint) from public, anon, authenticated;
grant execute on function replace_policy_blocks(text[], bigint) to service_role;

-- A DELETE that filters on columns must also pass a SELECT policy, so without
-- this a blocked member could not see (and therefore not delete) their own
-- membership row, and wm_self_leave would silently do nothing. It exposes only
-- the caller's own rows.
drop policy if exists wm_select_self on workspace_members;
create policy wm_select_self on workspace_members for select using (user_id = auth.uid());
