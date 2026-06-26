-- Stream workspace_invites so the owner's sent-invite list and members react in
-- real time. (workspace_members was already added in 0001.)
alter publication supabase_realtime add table workspace_invites;
