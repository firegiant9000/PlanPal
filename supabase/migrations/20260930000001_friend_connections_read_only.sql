-- friend_connections: read-only to end users.
--
-- The core schema granted `authenticated` INSERT, UPDATE and DELETE here,
-- guarded by party-based policies that constrain who a row names but not its
-- `status`. That is not the design the same migration describes: requests are
-- to be created, accepted and removed by SECURITY DEFINER RPCs (roadmap P1),
-- and nothing in the apps, packages or Edge Functions writes this table today.
-- `users_select_self_or_friends` trusts `status = 'accepted'`, so the graph
-- must only be writable by those RPCs.
--
-- SELECT stays, under the existing `friend_conn_select_party` policy.
--
-- The three write policies are dropped rather than left inert. Without a grant
-- they do nothing, but a future `grant insert/update/delete` would silently
-- bring them back with the same gap. The P1 RPCs run as definer and need no
-- client-facing write policy.
--
-- Account deletion is unaffected: `delete_me()` removes auth.users and the
-- rows here go by ON DELETE CASCADE, which does not check the caller's grants.
--
-- Rollback (forward-only project): re-grant and re-create the policies from
-- 20260607120000_core_schema.sql in a new migration.

revoke insert, update, delete on public.friend_connections from public, anon, authenticated;

drop policy friend_conn_insert_requester on public.friend_connections;
drop policy friend_conn_update_party on public.friend_connections;
drop policy friend_conn_delete_party on public.friend_connections;
