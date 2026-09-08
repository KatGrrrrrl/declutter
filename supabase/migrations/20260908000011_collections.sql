-- =============================================================================
-- COLLECTIONS — named item sets ("Coin collection", "Wine cellar").
--
-- Why: families catalogue whole sets at once — forty coins, a shelf of wine —
-- and the parent should be able to decide the set in one swipe instead of
-- forty. A collection is ORGANIZATIONAL ONLY: items keep their own decision,
-- heir, story, and photos. Deleting a collection un-groups its items (FK is
-- ON DELETE SET NULL); it never deletes them.
--
-- Authority: any active member may create collections and file items into
-- them, exactly like rooms (items.room is member-writable). Decisions remain
-- owner-only via the existing items_guard — grouping never grants deciding.
--
-- Privacy: the client uploads a collection row lazily, only when a synced
-- (non-localOnly) item references it — a collection holding nothing but
-- localOnly items never reaches this table, not even its name.
--
-- Realtime: deliberately NOT added to the supabase_realtime publication.
-- items.collection_id changes ride the existing items channel; collection
-- names arrive with the next pull. Revisit if that lag ever matters.
-- =============================================================================

create table public.collections (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references public.households (id) on delete cascade,
  name            text not null check (char_length(trim(name)) between 1 and 120),
  note            text,
  created_by      uuid not null,
  -- Display name, mirrored from the client (precedent: items.decided_by_name).
  -- The uuid may be whichever member first SYNCED the collection, not who
  -- created it locally; the name is the truthful byline.
  created_by_name text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index collections_household_idx on public.collections (household_id);

alter table public.items
  add column collection_id uuid references public.collections (id) on delete set null;

create index items_collection_idx on public.items (collection_id)
  where collection_id is not null;
-- NOTE: items.collection_id is intentionally NOT frozen by items_guard —
-- member-writable, same as room. It syncs like any other member-editable
-- column.

create trigger collections_set_updated_at
  before update on public.collections
  for each row execute function private.set_updated_at();

-- ---- guard: identity columns are immutable ----------------------------------
create or replace function private.collections_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.household_id is distinct from old.household_id then
      raise exception 'collections.household_id is immutable';
    end if;
    if new.created_by is distinct from old.created_by then
      raise exception 'collections.created_by is immutable';
    end if;
  end if;
  return new;
end;
$$;

create trigger collections_guard
  before update on public.collections
  for each row execute function private.collections_guard();

-- ---- audit: creation and deletion are household history ----------------------
create or replace function private.audit_collections()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.log_audit(new.household_id, 'collection.created', 'collection',
      new.id, jsonb_build_object('name', new.name));
    return null;
  else
    -- DELETE. Skip when it's a household-deletion cascade (household gone).
    if exists (select 1 from public.households h where h.id = old.household_id) then
      perform private.log_audit(old.household_id, 'collection.deleted', 'collection',
        old.id, jsonb_build_object('name', old.name));
    end if;
    return null;
  end if;
end;
$$;

create trigger collections_audit
  after insert or delete on public.collections
  for each row execute function private.audit_collections();

-- ---- RLS: any active member, scoped to their household -----------------------
-- (Helpers, not household_members directly — the recursion rule.)
alter table public.collections enable row level security;

create policy collections_select_member on public.collections
  for select to authenticated
  using (private.is_household_member(household_id));

create policy collections_insert_member on public.collections
  for insert to authenticated
  with check (
    private.is_household_member(household_id)
    and created_by = (select auth.uid())
  );

create policy collections_update_member on public.collections
  for update to authenticated
  using (private.is_household_member(household_id))
  with check (private.is_household_member(household_id));

create policy collections_delete_member on public.collections
  for delete to authenticated
  using (private.is_household_member(household_id));

-- ---- privileges (the schema-wide grant in 0001 ran before this table existed)
revoke all on public.collections from anon;
grant select, insert, update, delete on public.collections to authenticated;
