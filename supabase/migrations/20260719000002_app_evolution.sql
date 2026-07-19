-- =============================================================================
-- DECLUTTER — migration 0002: align cloud schema with app evolution
-- =============================================================================
-- The local-first app grew features after 0001 was written. This migration
-- adds their cloud counterparts:
--
--   1. item_messages     — per-item family chat threads
--   2. items.donate_to   — donation destination (charity or person)
--   3. roster_entries    — name-only members/invitations (pre-auth roster,
--                          incl. decider designation), backed up from devices
--   4. household_plans   — free/pro entitlement per household; written ONLY by
--                          the Stripe webhook (service role), never by clients
--
-- Deliberate absence: the app's `localOnly` item flag has NO cloud column.
-- Its contract is "never leaves the device", so flagged items are simply never
-- uploaded — a column here would invite bugs that violate the promise.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. item_messages — family chat about one item, visible to the household.
-- -----------------------------------------------------------------------------
create table public.item_messages (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references public.items (id) on delete cascade,
  author      uuid not null,          -- auth.uid() of the writer
  author_name text not null,          -- display name shown in the thread
  body        text not null check (length(trim(body)) > 0),
  created_at  timestamptz not null default now()
);

create index item_messages_item_idx on public.item_messages (item_id, created_at);

alter table public.item_messages enable row level security;

-- Household members read the whole thread.
create policy item_messages_select on public.item_messages
  for select to authenticated
  using (private.is_household_member(private.item_household(item_id)));

-- Any member may post, but only as themselves.
create policy item_messages_insert on public.item_messages
  for insert to authenticated
  with check (
    author = (select auth.uid())
    and private.is_household_member(private.item_household(item_id))
  );

-- Authors may delete their own message; nobody edits (chat is a record).
create policy item_messages_delete on public.item_messages
  for delete to authenticated
  using (author = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- 2. Donation destination on items.
-- -----------------------------------------------------------------------------
create type public.donate_kind as enum ('charity', 'person');

alter table public.items
  add column donate_to      text,
  add column donate_to_kind public.donate_kind;

comment on column public.items.donate_to is
  'Where a donated item should go — a charity name or a person. Only meaningful when decision = donate.';

-- -----------------------------------------------------------------------------
-- 3. roster_entries — the household roster as devices know it today: members
--    and pending invitations identified by NAME only (no auth user yet).
--    When real account-linked invitations ship, accepted entries graduate to
--    household_members rows and the roster entry records the linkage moment.
-- -----------------------------------------------------------------------------
create table public.roster_entries (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references public.households (id) on delete cascade,
  name            text not null check (length(trim(name)) > 0),
  relationship    text,
  status          public.member_status not null default 'invited',
  is_decider      boolean not null default false,
  invited_by_name text,
  created_at      timestamptz not null default now(),

  -- One roster line per person per household (case-insensitive).
  constraint roster_unique_name unique (household_id, name)
);

create index roster_entries_household_idx on public.roster_entries (household_id);

alter table public.roster_entries enable row level security;

create policy roster_select on public.roster_entries
  for select to authenticated
  using (private.is_household_member(household_id));

-- Members may add roster lines (anyone can suggest a member)…
create policy roster_insert on public.roster_entries
  for insert to authenticated
  with check (private.is_household_member(household_id));

-- …but only owners (the final say) approve/decline/edit or remove them.
create policy roster_update on public.roster_entries
  for update to authenticated
  using (private.is_household_owner(household_id))
  with check (private.is_household_owner(household_id));

create policy roster_delete on public.roster_entries
  for delete to authenticated
  using (private.is_household_owner(household_id));

-- -----------------------------------------------------------------------------
-- 4. household_plans — entitlement state. Clients READ it; only the Stripe
--    webhook (service role) writes it. No insert/update/delete policies for
--    authenticated on purpose: absence of a policy = denied.
-- -----------------------------------------------------------------------------
create table public.household_plans (
  household_id           uuid primary key references public.households (id) on delete cascade,
  plan                   text not null default 'free' check (plan in ('free', 'pro')),
  stripe_customer_id     text,
  stripe_subscription_id text,
  current_period_end     timestamptz,
  updated_at             timestamptz not null default now()
);

alter table public.household_plans enable row level security;

create policy household_plans_select on public.household_plans
  for select to authenticated
  using (private.is_household_member(household_id));

create trigger household_plans_updated_at
  before update on public.household_plans
  for each row execute function private.set_updated_at();

-- Every household gets a plan row at creation (free by default), so client
-- reads never have to handle absence.
create or replace function private.handle_new_household_plan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.household_plans (household_id) values (new.id);
  return new;
end;
$$;

create trigger households_plan_bootstrap
  after insert on public.households
  for each row execute function private.handle_new_household_plan();

-- Lock down the new definer function like the others (0001 pattern).
revoke all on function private.handle_new_household_plan() from public, anon, authenticated;
