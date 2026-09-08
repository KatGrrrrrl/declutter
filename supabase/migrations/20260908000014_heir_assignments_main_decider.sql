-- =============================================================================
-- Heir assignments sync (the Phase-2 table 0001 deferred) + items.main_decider_name.
--
-- Until now both stopped at the device: set an heir or a main decider on the
-- phone and no other device ever saw it — and nothing said so. Stories, tags,
-- decisions, archive and collections all sync; these were the last two item
-- fields that didn't.
--
-- Why a separate table for heirs, not columns on items: heir assignments are
-- PRIVATE TO THE OWNER BY DEFAULT (core principle). items rows are readable
-- by every member, and RLS cannot hide a column — but it can hide a ROW. So
-- an assignment is its own row, and the SELECT policy shows a non-owner only
-- the ones the owner has marked 'revealed'. 'after_death' stays hidden until
-- the Phase-3 legacy unlock exists to reveal it. Exactly the plan 0001 §9
-- wrote down, built as written.
--
-- One assignment per item (the client model is a single heir per item).
-- household_id is stamped from the item server-side and immutable, so a row
-- can never be filed against a different family's item. The heir must be one
-- of the same household's people.
--
-- main_decider_name lives on items (it is not secret — it says whose call an
-- item is, which every member may see) but only owner-level members may set
-- it, same authority as the decision itself. Additive trigger, like 0009's
-- decided_by_name guard, rather than editing items_guard.
--
-- Spec §4 asks for field-level encryption at rest on heir data. As with
-- market_value_cents in 0001, that is an application/Edge-Function concern
-- and is intentionally NOT wired here; flagged for hardening.
-- =============================================================================

-- ---- items.main_decider_name -------------------------------------------------
alter table public.items
  add column if not exists main_decider_name text;

comment on column public.items.main_decider_name is
  'Which of the household''s deciders this item is primarily for (display name). Every decider may still decide it. Owner-level writes only.';

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
    if new.main_decider_name is distinct from old.main_decider_name
       and actor is not null
       and not private.is_household_owner(old.household_id) then
      raise exception 'only the household owner may set an item''s main decider';
    end if;
  elsif tg_op = 'INSERT' then
    -- A contributor's capture never carries one; drop it rather than fail
    -- the whole insert (the client omits it for contributors anyway).
    if new.main_decider_name is not null
       and actor is not null
       and not private.is_household_owner(new.household_id) then
      new.main_decider_name := null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists items_main_decider_guard on public.items;
create trigger items_main_decider_guard
  before insert or update on public.items
  for each row execute function private.items_main_decider_guard();

-- ---- heir_assignments --------------------------------------------------------
create table public.heir_assignments (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  item_id       uuid not null unique references public.items (id) on delete cascade,
  person_id     uuid not null references public.people (id) on delete cascade,
  visibility    public.heir_visibility not null default 'owner_only',
  assigned_by   uuid default auth.uid(),
  assigned_at   timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.heir_assignments is
  'Who an item is meant for. Owner-only writes; a non-owner member reads a row only once its visibility is revealed.';

create index heir_assignments_household_idx on public.heir_assignments (household_id);

-- Realtime carries DELETEs with the full old row (household filter + RLS still apply).
alter table public.heir_assignments replica identity full;

-- ---- guard: tenancy from the item, immutable; heir from the same household ----
create or replace function private.heir_assignments_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- Authoritative: the item's household, never the client's claim.
    select i.household_id into new.household_id from public.items i where i.id = new.item_id;
    if new.household_id is null then
      raise exception 'heir_assignments.item_id must reference an existing item';
    end if;
  else
    if new.household_id <> old.household_id then
      raise exception 'heir_assignments.household_id is immutable';
    end if;
    if new.item_id <> old.item_id then
      raise exception 'heir_assignments.item_id is immutable';
    end if;
    new.updated_at := now();
  end if;

  if not exists (
    select 1 from public.people p
    where p.id = new.person_id and p.household_id = new.household_id
  ) then
    raise exception 'the heir must be one of this household''s people';
  end if;

  return new;
end;
$$;

create trigger heir_assignments_guard
  before insert or update on public.heir_assignments
  for each row execute function private.heir_assignments_guard();

-- ---- audit: as consequential as a decision --------------------------------------
create or replace function private.audit_heir_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.log_audit(
    coalesce(new.household_id, old.household_id),
    case tg_op when 'DELETE' then 'heir.unassigned' else 'heir.assigned' end,
    'item',
    coalesce(new.item_id, old.item_id),
    jsonb_build_object(
      'person_id',  coalesce(new.person_id, old.person_id),
      'visibility', coalesce(new.visibility, old.visibility),
      'from_person_id', case when tg_op = 'UPDATE' then old.person_id end
    ));
  return null;  -- AFTER trigger
end;
$$;

create trigger heir_assignments_audit
  after insert or update or delete on public.heir_assignments
  for each row execute function private.audit_heir_assignment();

-- ---- RLS ---------------------------------------------------------------------
-- (Helpers, not household_members directly — the recursion rule.)
alter table public.heir_assignments enable row level security;

-- Owners see every assignment. Other members see only what the owner has
-- revealed; 'owner_only' and 'after_death' rows do not exist for them.
create policy heir_assignments_select on public.heir_assignments
  for select to authenticated
  using (
    private.is_household_owner(household_id)
    or (private.is_household_member(household_id) and visibility = 'revealed')
  );

create policy heir_assignments_insert_owner on public.heir_assignments
  for insert to authenticated
  with check (private.is_household_owner(household_id));

create policy heir_assignments_update_owner on public.heir_assignments
  for update to authenticated
  using (private.is_household_owner(household_id))
  with check (private.is_household_owner(household_id));

create policy heir_assignments_delete_owner on public.heir_assignments
  for delete to authenticated
  using (private.is_household_owner(household_id));

-- ---- privileges (the schema-wide grant in 0001 ran before this table existed)
revoke all on public.heir_assignments from anon;
grant select, insert, update, delete on public.heir_assignments to authenticated;

-- ---- realtime: owner devices see assignments change live; contributors only
-- ever receive rows the SELECT policy lets through.
alter publication supabase_realtime add table public.heir_assignments;
