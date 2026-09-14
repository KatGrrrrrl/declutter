-- =============================================================================
-- SECURITY HOTFIX: private.is_household_owner must answer false, never NULL
--
-- is_household_owner(hid) was `household_role(hid) in ('owner','co_owner')`.
-- For anyone without an ACTIVE membership, household_role returns no row, and
-- `NULL in (...)` is NULL — not false. In an RLS policy that is harmless
-- (NULL denies). In a trigger it is not: every guard phrased as
--
--     if <change> and not private.is_household_owner(hid) then raise ...
--
-- evaluates `not NULL` → NULL, and plpgsql treats an IF on NULL as false, so
-- the exception is silently skipped.
--
-- The one path where the caller has no active membership yet is accepting an
-- invitation. members_update_accept_own_invite lets an invitee update their
-- own invited row, and members_guard's "only the household owner may change
-- roles" check was the only thing standing between that update and a role
-- change. Probed against production on 2026-09-14 inside a rolled-back
-- transaction: an invited contributor could accept while setting
-- role = 'owner', and the row came back as owner — the final say over every
-- item and sight of every private heir assignment, from a single REST call
-- with their own JWT. The audit log showed no role change had ever occurred,
-- and no active decider existed who had not been invited as one.
--
-- Fixing the helper (rather than each caller) repairs members_guard,
-- items_guard and items_main_decider_guard together, and any guard written
-- the same way later. Policies are unaffected: NULL and false both deny.
-- =============================================================================

create or replace function private.is_household_owner(hid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.household_role(hid) in ('owner', 'co_owner'), false);
$$;
