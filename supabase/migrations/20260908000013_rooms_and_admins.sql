-- =============================================================================
-- ROOMS + ADMINISTRATORS
--
-- 1. rooms — the house's map. Families do not live in five canned room names:
--    they have a sun porch, a workshop, a boathouse. And when a child is
--    photographing a parent's home they need to know WHERE a room is — which
--    floor, and how to find it ("end of the landing, on the left"). Both are
--    household-shared, so they belong in the cloud rather than on one device.
--
--    Keyed by NAME, not id. items.room is a text column (0001) and stays one:
--    the name IS the link between an item and its room. That makes a room
--    record metadata ABOUT a name, which is what lets a room arrive on an item
--    from a device that has never seen the room row. The unique constraint is
--    therefore the real primary key in practice — two devices that both type
--    "Attic" converge on one row instead of racing to duplicate it.
--
--    Authority: any active member may add or edit a room, exactly like
--    collections and like items.room itself. Deleting is narrower (see the
--    delete policy): the owner, or whoever created the room.
--
--    Privacy: unlike collections, room rows are pushed EAGERLY rather than
--    lazily. A room name is structural — it discloses nothing about any one
--    item — and a room nobody has photographed yet is still part of the map
--    the family needs. localOnly items keep their own room name off the cloud
--    by never being uploaded at all; that is unchanged.
--
--    Realtime: deliberately NOT in the supabase_realtime publication, matching
--    collections. Room edits arrive with the next pull.
--
-- 2. roster_entries.is_admin — who ADMINISTERS a household, as opposed to who
--    decides its items. The parent (owner) remains the sole authority over
--    every ITEM decision and every heir assignment; that is untouched here.
--    Administering is the other job: who is in the family, and what stays in
--    the record. It is usually the adult child who set the home up, which is
--    why it cannot be inferred from is_decider — the deciders are frequently
--    invitees who have not joined yet.
--
--    is_decider and is_admin are independent flags on purpose. A person can be
--    either, both, or neither.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. rooms
-- -----------------------------------------------------------------------------
create table public.rooms (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references public.households (id) on delete cascade,
  name            text not null check (char_length(trim(name)) between 1 and 80),
  -- Free text, not an enum: the client suggests Basement/Main floor/Upstairs/
  -- Attic/Outside, and a family with a "Boathouse" just types it. An enum here
  -- would need a migration every time a house is unusual.
  floor           text check (floor is null or char_length(trim(floor)) between 1 and 60),
  -- How to find it, in the family's own words.
  location_note   text check (location_note is null or char_length(location_note) <= 400),
  created_by      uuid not null,
  -- Display name, mirrored from the client (precedent: collections.created_by_name).
  created_by_name text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- The room's name is its identity within a household (see header).
  constraint rooms_unique_name unique (household_id, name)
);

create index rooms_household_idx on public.rooms (household_id);

create trigger rooms_set_updated_at
  before update on public.rooms
  for each row execute function private.set_updated_at();

-- ---- guard: identity columns are immutable ----------------------------------
-- A room is never moved between households, and never re-attributed. (name IS
-- mutable: renaming a room is a supported edit, and the client carries the
-- items across with it.)
create or replace function private.rooms_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.household_id is distinct from old.household_id then
    raise exception 'rooms.household_id is immutable';
  end if;
  if new.created_by is distinct from old.created_by then
    raise exception 'rooms.created_by is immutable';
  end if;
  return new;
end;
$$;

create trigger rooms_guard
  before update on public.rooms
  for each row execute function private.rooms_guard();

-- ---- audit: the shape of the house is household history ----------------------
create or replace function private.audit_rooms()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.log_audit(new.household_id, 'room.created', 'room',
      new.id, jsonb_build_object('name', new.name));
    return null;
  else
    -- DELETE. Skip when it's a household-deletion cascade (household gone).
    if exists (select 1 from public.households h where h.id = old.household_id) then
      perform private.log_audit(old.household_id, 'room.deleted', 'room',
        old.id, jsonb_build_object('name', old.name));
    end if;
    return null;
  end if;
end;
$$;

create trigger rooms_audit
  after insert or delete on public.rooms
  for each row execute function private.audit_rooms();

-- ---- RLS ---------------------------------------------------------------------
-- (Helpers, not household_members directly — the recursion rule.)
alter table public.rooms enable row level security;

create policy rooms_select_member on public.rooms
  for select to authenticated
  using (private.is_household_member(household_id));

create policy rooms_insert_member on public.rooms
  for insert to authenticated
  with check (
    private.is_household_member(household_id)
    and created_by = (select auth.uid())
  );

-- Any member may edit a room: fixing a floor or a "how to find it" note is
-- the same class of edit as fixing an item's room, which is already open.
create policy rooms_update_member on public.rooms
  for update to authenticated
  using (private.is_household_member(household_id))
  with check (private.is_household_member(household_id));

-- Deleting is narrower than editing — a removed room is a removed part of the
-- map for everyone. The owner (the app's administrator) may remove any room;
-- anyone else may remove only one they added themselves, which covers the
-- realistic case of undoing your own typo. Precedent: item_photos_delete.
create policy rooms_delete on public.rooms
  for delete to authenticated
  using (
    private.is_household_owner(household_id)
    or created_by = (select auth.uid())
  );

-- ---- privileges (the schema-wide grant in 0001 ran before this table existed)
revoke all on public.rooms from anon;
grant select, insert, update, delete on public.rooms to authenticated;

-- -----------------------------------------------------------------------------
-- 2. roster_entries.is_admin
-- -----------------------------------------------------------------------------
alter table public.roster_entries
  add column is_admin boolean not null default false;

comment on column public.roster_entries.is_admin is
  'Administers the household — may remove any member (deciders included) and '
  'any item. Independent of is_decider, which is authority over ITEM '
  'decisions and heirs. Usually the person who set the home up.';

-- Back-fill: existing households are administered by whoever set them up, and
-- the roster records that person as the earliest active line. Falls back to
-- the deciders where no active line exists (an all-invited roster), so no
-- household is left with nobody able to manage it.
with first_active as (
  select distinct on (household_id) household_id, id
  from public.roster_entries
  where status = 'active'
  order by household_id, created_at, id
)
update public.roster_entries r
set is_admin = true
from first_active f
where r.id = f.id;

update public.roster_entries r
set is_admin = true
where r.is_decider
  and not exists (
    select 1 from public.roster_entries x
    where x.household_id = r.household_id and x.is_admin
  );
