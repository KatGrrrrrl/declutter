-- =============================================================================
-- DECLUTTER — migration 0007: email notification preferences
-- =============================================================================
-- "Somewhere that allows you to get emails if you want when something is added
-- to your list. Or you can choose to get a list at the end of the day."
--
-- One row per (user, household): each member independently chooses
--   off      — no email, check the app when you like (the default)
--   instant  — an email whenever a family member adds an item
--   daily    — one evening digest of everything added in the last day
--
-- The row also carries the member's delivery email (copied from their auth
-- session on write) so the sending Edge Functions — notify-item-added and
-- daily-digest — can fan out with a single indexed read and never need to
-- touch auth.users.
--
-- Writes are strictly self-service: you manage YOUR row only, and only for a
-- household you actually belong to. The 0001 private.* definer helpers do the
-- membership check, as everywhere else.
-- =============================================================================

create type public.notify_mode as enum ('off', 'instant', 'daily');

create table public.notification_prefs (
  user_id       uuid not null,                     -- auth.uid() of the subscriber
  household_id  uuid not null references public.households (id) on delete cascade,
  mode          public.notify_mode not null default 'off',
  email         text not null,                     -- delivery address (from the auth session)
  updated_at    timestamptz default now(),
  primary key (user_id, household_id)
);

comment on table public.notification_prefs is
  'Per-member email preference (off / instant / daily) for one household. '
  'Read by the notify-item-added and daily-digest Edge Functions (service role).';

-- The fanout query shape for both senders: "who in this household chose
-- instant?" / "who chose daily?".
create index notification_prefs_household_mode_idx
  on public.notification_prefs (household_id, mode);

create trigger notification_prefs_updated_at
  before update on public.notification_prefs
  for each row execute function private.set_updated_at();

-- ---- RLS: your own row only ---------------------------------------------------
alter table public.notification_prefs enable row level security;

create policy notification_prefs_select_own on public.notification_prefs
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Creating or changing a preference additionally requires ACTIVE membership of
-- the household — you cannot subscribe to a household you are not part of.
create policy notification_prefs_insert_own on public.notification_prefs
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and private.is_household_member(household_id)
  );

create policy notification_prefs_update_own on public.notification_prefs
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and private.is_household_member(household_id)
  );

-- Deleting your own row is always allowed (even after leaving the household —
-- unsubscribing must never be blocked by a membership check).
create policy notification_prefs_delete_own on public.notification_prefs
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---- privilege hygiene (0001 pattern) -----------------------------------------
-- No anonymous surface; authenticated gets DML and RLS decides row by row.
revoke all on public.notification_prefs from anon;
grant select, insert, update, delete on public.notification_prefs to authenticated;
