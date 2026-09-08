-- =============================================================================
-- LET A HOUSEHOLD BE DELETED: the last-owner guard must not block the cascade.
--
-- Why: members_guard's "a household must keep at least one active owner" rule
-- (written for demote/revoke/remove) also fires while household_members rows
-- are being CASCADE-deleted by `delete from households` — the owner's own
-- member row is always the last active owner, so the whole delete raises.
-- Net effect found by the collections e2e probe: NO household could be
-- deleted by anyone — not the owner in Settings ("Delete everywhere"), not
-- the service role cleaning up e2e fixtures.
--
-- Fix: the same cascade detection audit_members has used since 0001 — during
-- a household cascade the parent row is already gone, so skip the last-owner
-- check when the household no longer exists. Deleting or demoting the last
-- owner of a LIVING household stays forbidden, exactly as before.
-- =============================================================================

create or replace function private.members_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  remaining_owners int;
begin
  if tg_op = 'INSERT' then
    new.invited_email := lower(new.invited_email);
    return new;
  end if;

  -- Shared last-owner guard for UPDATE (demote/revoke) and DELETE. Skipped
  -- when the household row itself is already gone: that's the delete-household
  -- cascade, where removing every member is the whole point.
  if old.status = 'active' and old.role in ('owner', 'co_owner') then
    if tg_op = 'DELETE'
       or new.status <> 'active'
       or new.role not in ('owner', 'co_owner') then
      select count(*) into remaining_owners
      from public.household_members m
      where m.household_id = old.household_id
        and m.status = 'active'
        and m.role in ('owner', 'co_owner')
        and m.id <> old.id;
      if remaining_owners = 0
         and exists (select 1 from public.households h where h.id = old.household_id) then
        raise exception 'a household must keep at least one active owner';
      end if;
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  -- UPDATE from here on.
  if new.household_id <> old.household_id then
    raise exception 'household_members.household_id is immutable';
  end if;
  if new.invited_by is distinct from old.invited_by then
    raise exception 'household_members.invited_by is immutable';
  end if;
  if old.user_id is not null and new.user_id is distinct from old.user_id then
    raise exception 'household_members.user_id cannot be reassigned';
  end if;
  new.invited_email := lower(new.invited_email);

  if new.status is distinct from old.status then
    if old.status = 'invited' and new.status = 'active' then
      -- The accept path. Service-role callers (actor null) are trusted;
      -- everyone else must be the addressed invitee, authenticated.
      if actor is not null then
        if new.user_id is distinct from actor then
          raise exception 'invite must be accepted as yourself';
        end if;
        if private.jwt_email() = '' or private.jwt_email() <> old.invited_email then
          raise exception 'invite is addressed to a different email';
        end if;
      end if;
      new.accepted_at := coalesce(new.accepted_at, now());
    elsif new.status = 'revoked' and old.status in ('invited', 'active') then
      null;  -- allowed; RLS restricts WHO (owners) may perform it
    else
      raise exception 'illegal membership transition % -> %', old.status, new.status;
    end if;
  end if;

  -- Role changes on a live row are owner-level actions (RLS also gates this;
  -- re-checked here so the accept path can't smuggle a promotion).
  if new.role is distinct from old.role
     and actor is not null
     and not private.is_household_owner(old.household_id) then
    raise exception 'only the household owner may change roles';
  end if;

  return new;
end;
$$;
