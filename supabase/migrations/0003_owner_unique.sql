-- One owner per workspace: closes the check-then-write race in claim-guild.
create unique index if not exists one_owner_per_workspace
  on workspace_members (workspace_id)
  where role = 'owner';
