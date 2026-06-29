-- Let any member delete their OWN membership row (leave a guild). The existing
-- wm_delete policy (0002) is owner-only; permissive policies are OR-combined, so
-- a row is deletable when is_owner(ws) OR it is the caller's own row. Scoped
-- strictly to user_id = auth.uid(): a member cannot delete other members, and it
-- grants owners nothing they didn't already have via wm_delete.
create policy wm_self_leave on workspace_members
  for delete using (user_id = auth.uid());
