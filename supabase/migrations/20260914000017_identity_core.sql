-- =============================================================================
-- IDENTITY CORE — phase 0 of the core replacement (plan: melodic-hatching-glade)
--
-- The client has been deciding who people are from DISPLAY NAMES — a roster
-- that any member can write, matched to the signed-in account by a fuzzy
-- lookup — while the database already held the real answer in
-- household_members. Every authorization bug of the last fortnight traced back
-- to that gap. This migration moves the facts the client was reading off the
-- roster onto the membership row, where RLS and members_guard already stand
-- guard, so the rebuilt client can identify people by auth.users.id alone.
--
-- Everything here is ADDITIVE. The live client keeps working unchanged: it
-- still writes roster_entries and main_decider_name, and nothing it reads is
-- removed. roster_entries and the name columns are dropped only in 017, after
-- every reader is gone.
--
--   1. household_members gains is_admin, display_name, relationship,
--      back-filled from the roster.
--   2. private.is_household_admin(), and administrators get the powers
--      migration 0013 described but no policy ever granted: removing members,
--      items and rooms. Until now those calls from a non-owner administrator
--      silently touched no rows.
--   3. members_guard learns administrator standing (who may grant it, and
--      that a household keeps at least one), without losing a single existing
--      rule. audit_members records it.
--   4. roster_entries stops accepting authority flags from anyone. Any member
--      could insert a line with is_decider and is_admin both true; the client
--      trusted it. Harmless once the client reads membership instead — but it
--      should never have been writable, so it closes now rather than in 017.
--   5. item_messages gains household_id, so realtime can filter a chat feed to
--      one household instead of delivering every family's messages to every
--      subscriber and discarding them client-side.
--   6. items gains main_decider (a user id) beside main_decider_name.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. household_members: administrator standing and the family's own labels
-- -----------------------------------------------------------------------------
alter table public.household_members
  add column is_admin boolean not null default false,
  add column display_name text
    check (display_name is null or char_length(trim(display_name)) between 1 and 120),
  add column relationship text
    check (relationship is null or char_length(relationship) <= 80);

comment on column public.household_members.is_admin is
  'Administers the household: who is in it and what stays in the record. '
  'Independent of role — it grants NO authority over item decisions or heirs, '
  'which stay with owner/co_owner. Usually the adult child who set the home up.';
comment on column public.household_members.display_name is
  'What the family calls this person ("Mum"). A display cache only — never an identity or an authority check.';

-- Back-fill from the roster, matched on the invitation address. An accepted
-- invitation keeps invited_email; the household's creator never had one, so
-- their auth address stands in.
with member_email as (
  select hm.id, hm.household_id, hm.status,
         lower(coalesce(hm.invited_email, u.email)) as email
  from public.household_members hm
  left join auth.users u on u.id = hm.user_id
),
matched as (
  select distinct on (me.id)
         me.id, me.status, r.name, r.relationship, r.is_admin
  from member_email me
  join public.roster_entries r
    on r.household_id = me.household_id
   and lower(r.invited_email) = me.email
  where me.email is not null
  order by me.id, r.created_at desc
)
update public.household_members hm
   set display_name = left(trim(m.name), 120),
       relationship = left(m.relationship, 80),
       -- The roster's is_admin was writable by any member, so it is only
       -- carried onto someone who actually joined. An invitation that could
       -- have been self-flagged starts without it.
       is_admin     = (m.is_admin and m.status = 'active')
  from matched m
 where hm.id = m.id;

-- The creator's own roster line is the one with no address (nobody invites
-- themselves). Migration 0013 made the earliest active line the administrator
-- for exactly that reason, so pair it with the creator where it is unambiguous.
with creator_line as (
  select r.household_id, min(r.name) as name, min(r.relationship) as relationship
  from public.roster_entries r
  where r.invited_email is null and r.status = 'active' and r.is_admin
  group by r.household_id
  having count(*) = 1
)
update public.household_members hm
   set display_name = coalesce(hm.display_name, left(trim(c.name), 120)),
       relationship = coalesce(hm.relationship, left(c.relationship, 80))
  from creator_line c, public.households h
 where c.household_id = hm.household_id
   and h.id = hm.household_id
   and hm.user_id = h.created_by;

-- Whoever set a home up administers it — the rule 0013 applied to the roster.
update public.household_members hm
   set is_admin = true
  from public.households h
 where h.id = hm.household_id
   and hm.user_id = h.created_by
   and hm.status = 'active';

-- And no household is left with nobody able to manage it.
update public.household_members hm
   set is_admin = true
 where hm.status = 'active'
   and hm.role = 'owner'
   and not exists (
     select 1 from public.household_members x
     where x.household_id = hm.household_id and x.status = 'active' and x.is_admin
   );


-- -----------------------------------------------------------------------------
-- 2. private.is_household_admin + the powers administrators were promised
-- -----------------------------------------------------------------------------
create or replace function private.is_household_admin(hid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members m
    where m.household_id = hid
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and m.is_admin
  );
$$;

revoke all on function private.is_household_admin(uuid) from public, anon;
grant execute on function private.is_household_admin(uuid) to authenticated;

-- Administrators may manage membership. members_guard (below) still keeps
-- roles owner-only, so an administrator can remove a person but never promote
-- one into the final say.
create policy members_update_admin on public.household_members
  for update to authenticated
  using (private.is_household_admin(household_id))
  with check (private.is_household_admin(household_id));

-- A member may update their own row — in practice, their display name, now
-- that names live here instead of on the roster. members_guard is what keeps
-- this narrow: role, administrator standing, relationship and the invitation
-- address all stay out of a plain member's reach.
create policy members_update_self on public.household_members
  for update to authenticated
  using (user_id = (select auth.uid()) and status = 'active')
  with check (user_id = (select auth.uid()));

drop policy members_delete on public.household_members;
create policy members_delete on public.household_members
  for delete to authenticated
  using (
    private.is_household_owner(household_id)
    or private.is_household_admin(household_id)
    or user_id = (select auth.uid())
  );

drop policy items_delete on public.items;
create policy items_delete on public.items
  for delete to authenticated
  using (
    private.is_household_owner(household_id)
    or private.is_household_admin(household_id)
    or (created_by = (select auth.uid()) and decision = 'undecided'::public.item_decision)
  );

drop policy rooms_delete on public.rooms;
create policy rooms_delete on public.rooms
  for delete to authenticated
  using (
    private.is_household_owner(household_id)
    or private.is_household_admin(household_id)
    or created_by = (select auth.uid())
  );


-- -----------------------------------------------------------------------------
-- 3. members_guard: every existing rule, plus administrator standing
-- -----------------------------------------------------------------------------
create or replace function private.members_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  remaining_owners int;
  remaining_admins int;
  can_manage boolean;
begin
  if tg_op = 'INSERT' then
    new.invited_email := lower(new.invited_email);
    -- Nobody may create a membership that already administers, except the
    -- household's own bootstrap (the creator's first row) and trusted
    -- service-role callers such as invite-member.
    if new.is_admin and actor is not null
       and not exists (select 1 from public.households h
                        where h.id = new.household_id
                          and h.created_by = new.user_id
                          and new.role = 'owner')
       and not private.is_household_owner(new.household_id)
       and not private.is_household_admin(new.household_id) then
      raise exception 'only an owner or administrator may grant administrator standing';
    end if;
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

  -- Last-administrator guard, the same shape. A household nobody administers
  -- can never let anyone back in.
  if old.status = 'active' and old.is_admin then
    if tg_op = 'DELETE'
       or new.status <> 'active'
       or not new.is_admin then
      select count(*) into remaining_admins
      from public.household_members m
      where m.household_id = old.household_id
        and m.status = 'active'
        and m.is_admin
        and m.id <> old.id;
      if remaining_admins = 0
         and exists (select 1 from public.households h where h.id = old.household_id) then
        raise exception 'a household must keep at least one administrator';
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
  -- The address an invitation was sent to is how it is matched and how a
  -- re-invite finds it. Only trusted server code may change it; a typo is
  -- fixed by withdrawing the invitation and sending a new one.
  if actor is not null
     and old.invited_email is not null
     and lower(new.invited_email) is distinct from old.invited_email then
    raise exception 'household_members.invited_email cannot be changed';
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
      null;  -- allowed; RLS restricts WHO (owners, administrators) may perform it
    else
      raise exception 'illegal membership transition % -> %', old.status, new.status;
    end if;
  end if;

  -- Role changes on a live row are owner-level actions (RLS also gates this;
  -- re-checked here so the accept path can't smuggle a promotion, and so an
  -- administrator's update policy can't either).
  if new.role is distinct from old.role
     and actor is not null
     and not private.is_household_owner(old.household_id) then
    raise exception 'only the household owner may change roles';
  end if;

  if actor is not null then
    can_manage := private.is_household_owner(old.household_id)
               or private.is_household_admin(old.household_id);

    -- Administrator standing, and what the family calls someone's
    -- relationship, are household-level facts. The accept path in particular
    -- must never be a way to crown yourself.
    if (new.is_admin is distinct from old.is_admin
        or new.relationship is distinct from old.relationship)
       and not can_manage then
      raise exception 'only an owner or administrator may change administrator standing or relationship';
    end if;

    -- A display name may be set by the person themselves (including while
    -- accepting, when user_id becomes the actor) or by whoever manages the
    -- household.
    if new.display_name is distinct from old.display_name
       and new.user_id is distinct from actor
       and not can_manage then
      raise exception 'only the member, an owner or an administrator may change a display name';
    end if;
  end if;

  return new;
end;
$$;

create or replace function private.audit_members()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.log_audit(new.household_id,
      case when new.status = 'invited' then 'member.invited' else 'member.added' end,
      'member', new.id,
      jsonb_build_object('role', new.role, 'invited_email', new.invited_email,
                         'is_admin', new.is_admin));
    return null;
  elsif tg_op = 'UPDATE' then
    if old.status is distinct from new.status
       or old.role is distinct from new.role
       or old.is_admin is distinct from new.is_admin then
      perform private.log_audit(new.household_id, 'member.changed', 'member', new.id,
        jsonb_build_object('from_status', old.status, 'to_status', new.status,
                           'from_role', old.role, 'to_role', new.role,
                           'from_admin', old.is_admin, 'to_admin', new.is_admin));
    end if;
    return null;
  else
    -- DELETE. Skip logging when the delete is a household-deletion cascade:
    -- the parent household row is already gone, so an audit insert would
    -- violate audit_log's FK and abort the whole household deletion.
    if exists (select 1 from public.households h where h.id = old.household_id) then
      perform private.log_audit(old.household_id, 'member.removed', 'member', old.id,
        jsonb_build_object('role', old.role, 'user_id', old.user_id));
    end if;
    return null;
  end if;
end;
$$;

-- The creator's bootstrap row now administers from the first moment.
create or replace function private.handle_new_household()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.household_members
    (household_id, user_id, role, status, invited_by, accepted_at, is_admin)
  values
    (new.id, new.created_by, 'owner', 'active', new.created_by, now(), true);
  perform private.log_audit(new.id, 'household.created', 'household', new.id,
                            jsonb_build_object('name', new.name));
  return new;
end;
$$;


-- -----------------------------------------------------------------------------
-- 4. roster_entries stops accepting authority flags from ordinary members
-- -----------------------------------------------------------------------------
-- The final say stays the owner's to grant; administrator standing is the
-- owner's or an administrator's. A plain member may still add a name-only
-- line (anyone can suggest a person), exactly as before.
drop policy roster_insert on public.roster_entries;
create policy roster_insert on public.roster_entries
  for insert to authenticated
  with check (
    private.is_household_member(household_id)
    and (not is_decider or private.is_household_owner(household_id))
    and (not is_admin
         or private.is_household_owner(household_id)
         or private.is_household_admin(household_id))
  );


-- -----------------------------------------------------------------------------
-- 5. item_messages.household_id, so realtime can filter by household
-- -----------------------------------------------------------------------------
alter table public.item_messages
  add column household_id uuid references public.households (id) on delete cascade;

update public.item_messages m
   set household_id = i.household_id
  from public.items i
 where i.id = m.item_id;

-- Stamped from the item on every write and never taken from the client, so a
-- message can't be filed under a different family than its item.
create or replace function private.item_messages_stamp_household()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.household_id := private.item_household(new.item_id);
  if new.household_id is null then
    raise exception 'item_messages.item_id does not refer to an item';
  end if;
  return new;
end;
$$;

create trigger item_messages_stamp_household
  before insert or update on public.item_messages
  for each row execute function private.item_messages_stamp_household();

alter table public.item_messages alter column household_id set not null;

create index item_messages_household_idx
  on public.item_messages (household_id, created_at);


-- -----------------------------------------------------------------------------
-- 6. items.main_decider — the id beside the name
-- -----------------------------------------------------------------------------
alter table public.items
  add column main_decider uuid;

comment on column public.items.main_decider is
  'auth.users id of the decider this item is primarily for. Must be an active '
  'owner/co_owner of the same household. Replaces main_decider_name in 017; '
  'a decider who has not yet joined has no id, so the name remains until then.';

create or replace function private.items_main_decider_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
begin
  if tg_op = 'UPDATE' then
    if (new.main_decider_name is distinct from old.main_decider_name
        or new.main_decider is distinct from old.main_decider)
       and actor is not null
       and not private.is_household_owner(old.household_id) then
      raise exception 'only the household owner may set an item''s main decider';
    end if;
  elsif tg_op = 'INSERT' then
    -- A contributor's capture never carries one; drop it rather than fail
    -- the whole insert (the client omits it for contributors anyway).
    if actor is not null and not private.is_household_owner(new.household_id) then
      new.main_decider_name := null;
      new.main_decider := null;
    end if;
  end if;

  if new.main_decider is not null and not exists (
    select 1 from public.household_members m
    where m.household_id = new.household_id
      and m.user_id = new.main_decider
      and m.status = 'active'
      and m.role in ('owner', 'co_owner')
  ) then
    raise exception 'an item''s main decider must be an active decider of its household';
  end if;
  return new;
end;
$$;

-- Carry existing names across where the name identifies exactly one joined
-- decider in that household. Anything ambiguous stays name-only.
with candidates as (
  select i.id as item_id, min(m.user_id::text)::uuid as user_id
  from public.items i
  join public.household_members m
    on m.household_id = i.household_id
   and m.status = 'active'
   and m.role in ('owner', 'co_owner')
   and lower(m.display_name) = lower(i.main_decider_name)
  where i.main_decider_name is not null and i.main_decider is null
  group by i.id
  having count(*) = 1
)
update public.items i
   set main_decider = c.user_id
  from candidates c
 where i.id = c.item_id;
