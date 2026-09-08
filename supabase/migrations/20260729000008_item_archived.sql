-- =============================================================================
-- items.archived — make the archive shelf a shared fact, not a per-device one.
--
-- Archiving is the gentle alternative to deleting (see the Items inventory),
-- but it lived only in local state, so archiving on a phone left the item
-- sitting in the list on every other device. It is cloud-owned state like any
-- other item field; the existing items_update_member policy already lets any
-- member set it, and items_guard does not restrict it.
-- =============================================================================

alter table public.items
  add column if not exists archived boolean not null default false;

comment on column public.items.archived is
  'Soft-hidden from the main inventory. Reversible; distinct from deletion.';

-- The inventory reads "live items in this household" constantly; keep that
-- path off a sequential scan now that it carries an extra predicate.
create index if not exists items_household_archived_idx
  on public.items (household_id, archived);

-- Realtime DELETE events carry only the primary key unless the table
-- replicates the full old row. Without this, a delete on one device would
-- either be dropped by the `household_id` subscription filter or fail RLS,
-- so the item would linger on every other device until a manual restore.
alter table public.items replica identity full;
