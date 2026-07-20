-- =============================================================================
-- DECLUTTER — migration 0006: server-stamped inviter on household_members.
-- Same bug class as 0005 (found by tools/e2e-multiplayer.mjs): the insert
-- policy requires invited_by = auth.uid() but the column had no default, so
-- owners could never create invitations from the client.
-- =============================================================================

alter table public.household_members
  alter column invited_by set default auth.uid();
