-- =============================================================================
-- 018 — retire roster_entries
--
-- The roster was a list of people the DEVICE kept by name ("Mum", "Sam") and
-- mirrored to the cloud. Any member could write it, and the app used to read
-- authority from it — which is how someone could appear to have joined, or to
-- hold the final say, without ever having signed in. Migration 017 moved
-- everything that matters (administrator standing, the family's name for a
-- person, relationship) onto household_members, where RLS and members_guard
-- stand behind it, and the identity-core client (live since Sep 14, bundle
-- entry-9ec20a6c) no longer reads or writes the roster at all.
--
-- What this does:
--   1. Keeps a copy of every roster line in private.roster_entries_archive —
--      not reachable through the API — so nothing the family typed is lost.
--   2. decline_invite() stops touching the roster.
--   3. Drops public.roster_entries (its policies go with it).
--
-- Deliberately NOT dropped: items.decided_by_name and items.main_decider_name.
-- They are display caches next to the authoritative ids (decided_by,
-- main_decider), written by the same guarded update, and let a device show a
-- name without a membership lookup. Nothing decides anything from them.
--
-- Deploy order: notify-invite-declined (which read the roster for recipients)
-- is redeployed reading household_members BEFORE this runs.
-- =============================================================================

-- 1. Archive -------------------------------------------------------------------
create table if not exists private.roster_entries_archive as
  select r.*, now() as archived_at from public.roster_entries r;

revoke all on private.roster_entries_archive from public, anon, authenticated;

-- 2. decline_invite without the roster ------------------------------------------
create or replace function public.decline_invite(p_household_id uuid)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_id    uuid;
  v_email text := private.jwt_email();
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required';
  end if;
  -- No verified email, no claim on any invitation: invitations are addressed
  -- to an address, and that address is the only thing that identifies them.
  if v_email = '' then
    raise exception 'a verified email is required to decline an invitation';
  end if;

  update public.household_members m
     set status = 'revoked',
         declined_at = now()
   where m.household_id = p_household_id
     and m.status = 'invited'
     and lower(m.invited_email) = v_email
  returning m.id into v_id;

  if v_id is null then
    raise exception 'no pending invite for this account';
  end if;

  perform private.log_audit(p_household_id, 'member.declined', 'member', v_id,
    jsonb_build_object('invited_email', v_email));

  return v_id;
end;
$function$;

-- 3. Drop -------------------------------------------------------------------------
drop table public.roster_entries;
