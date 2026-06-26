-- Stream the workspaces row (guild metadata + keys_shared) so members react live
-- when the owner toggles AxiTools sharing or updates guild info. RLS (is_member)
-- still scopes who receives changes; the row holds no secrets.
alter publication supabase_realtime add table workspaces;
