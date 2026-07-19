-- =============================================================================
-- DECLUTTER — Phase 1 schema + RLS
-- Migration: 0001_declutter_phase1_schema.sql
-- Target:    Supabase (Postgres 15)
--
-- Scope: Phase 1 "core loop" only — households, membership + parent-approved
-- invites, people (heirs, forward-compat), items, photos, tags, stories,
-- audit log, and the private `item-photos` storage bucket.
--
-- Phase 2/3 tables are deliberately NOT created here (see the comment block at
-- the bottom), but every enum is created NOW with all future values so later
-- phases never have to churn enum types (ALTER TYPE ... ADD VALUE cannot run
-- inside a transaction on older PG, and removing values is impossible).
--
-- Security model in one paragraph (spec §1, §7):
--   The household is the tenant. The parent ("owner", optionally a spouse
--   "co_owner") is the sole decision authority. Children ("contributor") may
--   capture items, photos, tags, and stories but may NEVER set an item's
--   keep/donate/toss decision. "executor" exists in the role enum for Phase 3
--   but is granted nothing special here. All access is enforced by RLS keyed
--   on household membership + role, via SECURITY DEFINER helper functions in a
--   `private` schema (which avoids the classic recursive-RLS trap on
--   household_members). The audit log is append-only via a definer function
--   and readable by owners only.
--
-- Run with:  supabase db push   (or paste into the SQL editor)
-- =============================================================================


-- =============================================================================
-- 0. SCHEMAS
-- =============================================================================

-- `private` holds helper functions and trigger functions that must not be
-- directly meddled with by API roles. It is NOT exposed via PostgREST
-- (PostgREST only exposes `public` by default), but authenticated still needs
-- USAGE + EXECUTE so that RLS policies (which run as the calling user) can
-- invoke the helpers. See the GRANT section at the bottom.
create schema if not exists private;

-- gen_random_uuid() is built into PG 13+; no pgcrypto extension needed.


-- =============================================================================
-- 1. ENUMS — created with ALL values needed through Phase 3 (see header note)
-- =============================================================================

-- Roles (spec §1). 'executor' is Phase 3 (legacy access) but reserved now.
create type public.household_role as enum (
  'owner',        -- the parent; full authority
  'co_owner',     -- spouse/partner; full owner rights
  'contributor',  -- adult child; capture + suggest, never decide
  'executor'      -- Phase 3: read-only unlock after verification
);

-- Membership lifecycle (spec §4). Invite flow uses status='invited'.
create type public.member_status as enum (
  'invited',
  'active',
  'revoked'
);

-- The triage decision (spec §2). Only owners may move it off 'undecided'.
create type public.item_decision as enum (
  'undecided',
  'keep',
  'donate',
  'toss'
);

-- Where a value estimate came from. 'ai_comp' is Phase 3 (sold-comps lookup).
create type public.value_source as enum (
  'manual',
  'ai_comp'
);

-- Phase 2: heir_assignments.visibility. Reserved now, table comes later.
create type public.heir_visibility as enum (
  'owner_only',
  'after_death',
  'revealed'
);

-- Phase 2: item_requests.status. Reserved now, table comes later.
create type public.request_status as enum (
  'open',
  'acknowledged',
  'granted',
  'declined'
);

-- Phase 3: legacy_access.status / .trigger. Reserved now, tables come later.
create type public.legacy_status as enum (
  'designated',
  'pending_verification',
  'unlocked'
);

create type public.legacy_trigger as enum (
  'death',
  'incapacity'
);

-- audit_log.action is deliberately TEXT, not an enum: the set of auditable
-- actions grows with every feature and an enum would churn constantly. The
-- write path is a single definer function, so values stay controlled anyway.


-- =============================================================================
-- 2. TABLES
-- =============================================================================

-- -----------------------------------------------------------------------------
-- households — the tenant. Everything scopes to a household.
-- -----------------------------------------------------------------------------
-- Note on auth references: household_members.user_id gets a real FK to
-- auth.users (membership rows should die with the user). Actor-stamp columns
-- (created_by, decided_by, invited_by, actor_user_id) are plain uuids WITHOUT
-- an FK: they are historical facts that must survive user deletion, and
-- cross-schema FKs into the Supabase-managed auth schema add churn for no
-- integrity benefit on audit-style columns.
create table public.households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) between 1 and 120),
  created_by  uuid not null,                       -- auth.uid() of the creator
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.households is
  'Top-level tenant. The creator is auto-enrolled as owner by trigger.';

-- -----------------------------------------------------------------------------
-- household_members — membership, roles, AND the invite flow.
-- -----------------------------------------------------------------------------
-- DESIGN DECISION — invites live on this table (status = 'invited') rather
-- than in a separate invites table with a shareable token. Justification:
--   1. It matches the spec's §4 data model exactly (status enum includes
--      'invited'; invited_by/invited_at/accepted_at are columns here).
--   2. Membership checks stay single-table, which keeps the SECURITY DEFINER
--      helpers below trivial and fast.
--   3. Token links are an anti-goal for this product: a bearer token in a
--      text message is exactly the kind of surface an elder-finance-abuse
--      product should not have. Instead, acceptance requires the invitee to
--      be AUTHENTICATED and to have a verified auth email matching
--      invited_email (checked against auth.jwt() in the transition trigger).
--      No token, no expiry needed — a pending invite is inert until the right
--      email signs in, and owners can revoke it at any time.
-- Deviation from spec §4: added `invited_email` (the invitee has no auth uid
-- yet, so the row needs a way to identify who may claim it).
create table public.household_members (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references public.households (id) on delete cascade,
  user_id        uuid references auth.users (id) on delete cascade,
  role           public.household_role not null default 'contributor',
  status         public.member_status  not null default 'invited',
  invited_email  text,                              -- lowercased on write (trigger)
  invited_by     uuid,                              -- auth.uid() of the inviter
  invited_at     timestamptz not null default now(),
  accepted_at    timestamptz,

  -- Lifecycle shape: active rows are claimed, invited rows are unclaimed and
  -- addressed to an email. Revoked rows may be either (revoked invite or
  -- revoked member) so they are unconstrained here.
  constraint member_status_shape check (
    (status = 'active'  and user_id is not null and accepted_at is not null)
    or
    (status = 'invited' and user_id is null and invited_email is not null)
    or
    (status = 'revoked')
  )
);

comment on table public.household_members is
  'Membership + invite flow. NEVER write a policy on this table that selects '
  'from this table — use the private.* definer helpers (recursion trap).';

-- One live (non-revoked) membership per user per household...
create unique index household_members_one_live_membership
  on public.household_members (household_id, user_id)
  where user_id is not null and status <> 'revoked';

-- ...and one live invite per email per household (re-invite after revoke is a
-- new row, which this still permits).
create unique index household_members_one_live_invite
  on public.household_members (household_id, lower(invited_email))
  where status = 'invited';

create index household_members_household_idx on public.household_members (household_id);
create index household_members_user_idx      on public.household_members (user_id)
  where user_id is not null;

-- -----------------------------------------------------------------------------
-- people — heirs. Phase 1 creates the table (forward-compat: parent's "Heirs"
-- screen and Phase-2 heir_assignments FK here) but no assignment table yet.
-- -----------------------------------------------------------------------------
create table public.people (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references public.households (id) on delete cascade,
  display_name    text not null check (length(trim(display_name)) between 1 and 120),
  relationship    text,                            -- 'daughter', 'nephew', freeform
  linked_user_id  uuid,                            -- nullable; heir may not be an app user
  email           text,
  created_at      timestamptz not null default now()
);

create index people_household_idx on public.people (household_id);

-- -----------------------------------------------------------------------------
-- items — the inventory. The decision triple (decision, decided_by,
-- decided_at) is owner-only, enforced by RLS + a BEFORE trigger (belt AND
-- suspenders — see private.items_guard()).
-- -----------------------------------------------------------------------------
-- Spec §4 note: market_value_cents / heir data get field-level encryption at
-- rest. That is an application/Edge-Function concern (e.g. pgsodium or
-- app-layer envelope encryption) and is intentionally NOT wired in this
-- migration; the column is plain for Phase 1 and flagged for hardening.
create table public.items (
  id                 uuid primary key default gen_random_uuid(),
  household_id       uuid not null references public.households (id) on delete cascade,
  created_by         uuid not null,                -- contributor or owner who captured it
  title              text,                         -- nullable: batch capture is photo-first
  room               text,
  decision           public.item_decision not null default 'undecided',
  decided_by         uuid,                         -- ALWAYS the owner/co_owner who swiped
  decided_at         timestamptz,
  market_value_cents bigint check (market_value_cents is null or market_value_cents >= 0),
  is_sentimental     boolean not null default false,
  value_source       public.value_source not null default 'manual',
  note               text,
  is_duplicate_of    uuid references public.items (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  -- The decision triple moves as a unit: undecided items have no decider,
  -- decided items always record who and when.
  constraint items_decision_shape check (
    (decision = 'undecided' and decided_by is null and decided_at is null)
    or
    (decision <> 'undecided' and decided_by is not null and decided_at is not null)
  )
);

-- The two hot query shapes: the parent's swipe queue ("undecided in my
-- household") and the child's filtered inventory (household + decision chips).
create index items_household_decision_idx on public.items (household_id, decision);
create index items_household_room_idx     on public.items (household_id, room);

-- -----------------------------------------------------------------------------
-- item_photos — metadata rows; bytes live in the private `item-photos` bucket
-- at  household_id/item_id/filename  (see storage section).
-- -----------------------------------------------------------------------------
-- Deviation from spec §4: added `created_by` (uploader). Needed so deletion
-- rights ("uploader may remove their own mistaken shot") and the audit trail
-- don't require guessing from storage metadata.
create table public.item_photos (
  id             uuid primary key default gen_random_uuid(),
  item_id        uuid not null references public.items (id) on delete cascade,
  created_by     uuid not null,
  storage_path   text not null,                    -- 'household_id/item_id/uuid.jpg'
  width          integer check (width  is null or width  > 0),
  height         integer check (height is null or height > 0),
  exif_stripped  boolean not null default false,   -- set true by the upload Edge Fn
  is_primary     boolean not null default false,
  created_at     timestamptz not null default now()
);

create index item_photos_item_idx on public.item_photos (item_id);

-- At most one primary photo per item (partial unique index, not a constraint,
-- so "no primary yet" is legal during batch capture).
create unique index item_photos_one_primary
  on public.item_photos (item_id)
  where is_primary;

-- -----------------------------------------------------------------------------
-- item_tags — freeform now, AI-suggested in Phase 3. Composite PK per spec.
-- -----------------------------------------------------------------------------
create table public.item_tags (
  item_id  uuid not null references public.items (id) on delete cascade,
  tag      text not null check (length(trim(tag)) between 1 and 60),
  primary key (item_id, tag)                       -- doubles as the lookup index
);

-- -----------------------------------------------------------------------------
-- stories — voice-first memory layer. Audio bytes go in the same private
-- bucket convention; transcript is written by the transcription Edge Fn.
-- -----------------------------------------------------------------------------
create table public.stories (
  id            uuid primary key default gen_random_uuid(),
  item_id       uuid not null references public.items (id) on delete cascade,
  storage_path  text,                              -- nullable: text-only stories allowed
  transcript    text,
  created_by    uuid not null,
  created_at    timestamptz not null default now()
);

create index stories_item_idx on public.stories (item_id);

-- -----------------------------------------------------------------------------
-- audit_log — append-only, owner-readable. Doubles as the elder-abuse
-- deterrent (spec §7): the parent can always see who did what.
-- Writes happen ONLY through private.log_audit() (SECURITY DEFINER); the
-- authenticated role has its INSERT privilege revoked below and there is no
-- INSERT policy, so direct writes fail twice over.
-- -----------------------------------------------------------------------------
create table public.audit_log (
  id             bigint generated always as identity primary key,
  household_id   uuid not null references public.households (id) on delete cascade,
  actor_user_id  uuid,                             -- null = system/cron action
  action         text not null,                    -- e.g. 'item.decision_changed'
  target_type    text not null,                    -- 'item' | 'member' | ...
  target_id      uuid,
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

-- Owner reads are always "newest first for my household".
create index audit_log_household_created_idx
  on public.audit_log (household_id, created_at desc);


-- =============================================================================
-- 3. PRIVATE HELPER FUNCTIONS
-- =============================================================================
-- THE RECURSION TRAP, AND WHY THESE EXIST:
-- A policy on household_members that does `... where exists (select 1 from
-- household_members ...)` re-enters household_members' own RLS and recurses
-- (Postgres errors with "infinite recursion detected in policy"). The fix is
-- SECURITY DEFINER helpers: they run as the function owner (postgres), which
-- BYPASSES RLS on the tables they read, so membership lookups are plain index
-- scans with no policy re-entry. Every policy in this file goes through them.
--
-- All definer functions set `search_path = ''` and fully qualify every
-- identifier — the standard hardening against search-path hijacking.
-- =============================================================================

-- Lowercased verified email from the caller's JWT ('' when absent).
-- Invoker rights are fine here: it reads no tables.
create or replace function private.jwt_email()
returns text
language sql
stable
set search_path = ''
as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

-- Is the caller an ACTIVE member of this household? (Any role.)
create or replace function private.is_household_member(hid uuid)
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
  );
$$;

-- The caller's role in this household, or NULL if not an active member.
create or replace function private.household_role(hid uuid)
returns public.household_role
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from public.household_members m
  where m.household_id = hid
    and m.user_id = (select auth.uid())
    and m.status = 'active'
  limit 1;
$$;

-- Owner-level authority: 'owner' or 'co_owner' (spouse has full rights, §1).
create or replace function private.is_household_owner(hid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.household_role(hid) in ('owner', 'co_owner');
$$;

-- Resolve an item to its household without tripping items' own RLS.
-- Child tables (photos, tags, stories) and storage policies compose this with
-- the membership helpers above.
create or replace function private.item_household(iid uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select i.household_id
  from public.items i
  where i.id = iid;
$$;

-- The ONLY write path into audit_log. SECURITY DEFINER: runs as the table
-- owner, which bypasses audit_log's (policy-less) RLS. Not exposed as a
-- public RPC — it lives in `private` and is called from triggers below.
create or replace function private.log_audit(
  hid          uuid,
  p_action     text,
  p_target_type text,
  p_target_id  uuid,
  p_metadata   jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_log
    (household_id, actor_user_id, action, target_type, target_id, metadata)
  values
    (hid, (select auth.uid()), p_action, p_target_type, p_target_id, coalesce(p_metadata, '{}'::jsonb));
$$;


-- =============================================================================
-- 4. TRIGGER FUNCTIONS + TRIGGERS
-- =============================================================================

-- ---- generic updated_at ------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger households_set_updated_at
  before update on public.households
  for each row execute function private.set_updated_at();

create trigger items_set_updated_at
  before update on public.items
  for each row execute function private.set_updated_at();

-- ---- household bootstrap -----------------------------------------------------
-- Chicken-and-egg fix: you cannot pass the "owners may insert members" policy
-- for a household that has no members yet. So creating a household (INSERT
-- policy: created_by = auth.uid()) auto-enrolls the creator as its active
-- owner via this definer trigger.
create or replace function private.handle_new_household()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.household_members
    (household_id, user_id, role, status, invited_by, accepted_at)
  values
    (new.id, new.created_by, 'owner', 'active', new.created_by, now());
  perform private.log_audit(new.id, 'household.created', 'household', new.id,
                            jsonb_build_object('name', new.name));
  return new;
end;
$$;

create trigger households_bootstrap_owner
  after insert on public.households
  for each row execute function private.handle_new_household();

-- ---- items: owner-only decision authority -----------------------------------
-- RLS lets any active member UPDATE an item row (children legitimately edit
-- titles/rooms/notes on anything they can see). RLS WITH CHECK cannot compare
-- OLD vs NEW, so column-level authority lives here: any change to the
-- decision triple by a caller who is not owner/co_owner is rejected. This is
-- the "belt AND suspenders" the threat model demands — even if a policy is
-- later fat-fingered, the trigger still holds the line.
--
-- auth.uid() IS NULL means a service-role / server-side caller (Edge Function,
-- cron): trusted, allowed through (RLS is bypassed for service_role anyway;
-- triggers are not, so this branch must exist).
create or replace function private.items_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
begin
  if tg_op = 'UPDATE' then
    -- Tenancy and provenance are immutable.
    if new.household_id <> old.household_id then
      raise exception 'items.household_id is immutable';
    end if;
    if new.created_by <> old.created_by then
      raise exception 'items.created_by is immutable';
    end if;

    -- Decision triple: owner-level only.
    if (new.decision   is distinct from old.decision
        or new.decided_by is distinct from old.decided_by
        or new.decided_at is distinct from old.decided_at) then
      if actor is not null and not private.is_household_owner(old.household_id) then
        raise exception 'only the household owner may decide items';
      end if;
      -- Stamp the decision server-side; never trust client-supplied values.
      if new.decision is distinct from old.decision then
        if new.decision = 'undecided' then
          new.decided_by := null;
          new.decided_at := null;
        else
          new.decided_by := coalesce(actor, new.decided_by);
          new.decided_at := now();
        end if;
      end if;
    end if;

  elsif tg_op = 'INSERT' then
    -- Contributors always start items at 'undecided' (also enforced by the
    -- INSERT policy); an owner capturing + deciding in one step gets stamped.
    if new.decision <> 'undecided' then
      if actor is not null and not private.is_household_owner(new.household_id) then
        raise exception 'only the household owner may decide items';
      end if;
      new.decided_by := coalesce(actor, new.decided_by);
      new.decided_at := coalesce(new.decided_at, now());
    else
      new.decided_by := null;
      new.decided_at := null;
    end if;
  end if;

  return new;
end;
$$;

create trigger items_guard
  before insert or update on public.items
  for each row execute function private.items_guard();

-- ---- items: audit decision changes ------------------------------------------
create or replace function private.audit_item_decision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.log_audit(
    new.household_id, 'item.decision_changed', 'item', new.id,
    jsonb_build_object('from', old.decision, 'to', new.decision));
  return null;  -- AFTER trigger
end;
$$;

create trigger items_audit_decision
  after update on public.items
  for each row
  when (old.decision is distinct from new.decision)
  execute function private.audit_item_decision();

-- ---- household_members: state-machine + last-owner guard ---------------------
-- Enforces (in addition to RLS):
--   * normalized invited_email
--   * immutable household_id / invited_by; user_id set exactly once
--   * legal status transitions only:
--       invited -> active   : ONLY by the invitee — new.user_id must be the
--                             caller and the caller's verified JWT email must
--                             match invited_email (this IS the accept flow)
--       invited -> revoked  : owner cancels an invite
--       active  -> revoked  : owner removes a member (or a member leaves,
--                             which RLS expresses as self-DELETE)
--       anything else       : rejected (re-invite = insert a fresh row)
--   * a household can never lose its last active owner-level member
--     (demotion, revocation, or deletion of the last owner all fail)
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

  -- Shared last-owner guard for UPDATE (demote/revoke) and DELETE.
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
      if remaining_owners = 0 then
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

create trigger members_guard
  before insert or update or delete on public.household_members
  for each row execute function private.members_guard();

-- ---- household_members: audit every membership event -------------------------
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
      jsonb_build_object('role', new.role, 'invited_email', new.invited_email));
    return null;
  elsif tg_op = 'UPDATE' then
    if old.status is distinct from new.status or old.role is distinct from new.role then
      perform private.log_audit(new.household_id, 'member.changed', 'member', new.id,
        jsonb_build_object('from_status', old.status, 'to_status', new.status,
                           'from_role', old.role, 'to_role', new.role));
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

create trigger members_audit
  after insert or update or delete on public.household_members
  for each row execute function private.audit_members();


-- =============================================================================
-- 5. CONVENIENCE RPC — accept_invite
-- =============================================================================
-- The client COULD accept by updating its own invite row (the RLS policy +
-- members_guard below make that safe), but a single RPC is a friendlier API
-- and keeps the client from needing to know row ids. All validation still
-- happens in members_guard — this function is just ergonomics, not authority.
create or replace function public.accept_invite(p_household_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required';
  end if;

  update public.household_members m
     set status = 'active',
         user_id = (select auth.uid()),
         accepted_at = now()
   where m.household_id = p_household_id
     and m.status = 'invited'
     and lower(m.invited_email) = private.jwt_email()
  returning m.id into v_id;

  if v_id is null then
    raise exception 'no pending invite for this account';
  end if;
  return v_id;
end;
$$;


-- =============================================================================
-- 6. ROW LEVEL SECURITY
-- =============================================================================
-- Every table: RLS enabled AND forced-off for no one — the API roles (anon,
-- authenticated) only ever reach these tables through policies. service_role
-- bypasses RLS (Supabase default) for Edge Functions; the triggers above
-- still run for it, with the actor-is-null trusted branch.

alter table public.households        enable row level security;
alter table public.household_members enable row level security;
alter table public.people            enable row level security;
alter table public.items             enable row level security;
alter table public.item_photos       enable row level security;
alter table public.item_tags         enable row level security;
alter table public.stories           enable row level security;
alter table public.audit_log         enable row level security;

-- ---- households --------------------------------------------------------------
create policy households_select_member on public.households
  for select to authenticated
  using (private.is_household_member(id));

create policy households_insert_self on public.households
  for insert to authenticated
  with check (created_by = (select auth.uid()));

create policy households_update_owner on public.households
  for update to authenticated
  using (private.is_household_owner(id))
  with check (private.is_household_owner(id));

create policy households_delete_owner on public.households
  for delete to authenticated
  using (private.is_household_owner(id));

-- ---- household_members -------------------------------------------------------
-- NOTE: none of these policies select from household_members directly — they
-- go through the definer helpers or compare row columns to auth.uid()/JWT.
-- That is the entire recursion-avoidance strategy.

-- Members see the roster (Family screen); an invitee sees their own pending
-- invite (so the app can show "You've been invited to Mom's house").
create policy members_select on public.household_members
  for select to authenticated
  using (
    private.is_household_member(household_id)
    or (status = 'invited' and lower(invited_email) = private.jwt_email())
    or user_id = (select auth.uid())
  );

-- Only owners invite (spec: "invite child (parent-approved)"). New rows are
-- always pending invites; 'owner' rows are created only by the bootstrap
-- trigger, so an owner cannot mint a second primary owner via the API
-- (promoting to co_owner later is an UPDATE, audited).
create policy members_insert_owner_invites on public.household_members
  for insert to authenticated
  with check (
    private.is_household_owner(household_id)
    and status = 'invited'
    and role in ('co_owner', 'contributor', 'executor')
    and user_id is null
    and invited_email is not null
    and invited_by = (select auth.uid())
  );

-- Owners manage rows (revoke invites/members, change roles)...
create policy members_update_owner on public.household_members
  for update to authenticated
  using (private.is_household_owner(household_id))
  with check (private.is_household_owner(household_id));

-- ...and an invitee may flip exactly their own invite to active (the accept
-- flow; members_guard enforces email match + no privilege smuggling).
create policy members_update_accept_own_invite on public.household_members
  for update to authenticated
  using (status = 'invited' and lower(invited_email) = private.jwt_email())
  with check (status = 'active' and user_id = (select auth.uid()));

-- Owners remove rows; any member may remove THEIR OWN row (leave household).
-- The last-owner guard in members_guard stops an owner deleting themselves
-- out of an otherwise-ownerless household.
create policy members_delete on public.household_members
  for delete to authenticated
  using (
    private.is_household_owner(household_id)
    or user_id = (select auth.uid())
  );

-- ---- people ------------------------------------------------------------------
-- Everyone in the household can see the people list (names/relationships are
-- not the secret — Phase 2's heir_assignments.visibility protects WHO GETS
-- WHAT). Writes are owner-only: heirs are the parent's list.
create policy people_select_member on public.people
  for select to authenticated
  using (private.is_household_member(household_id));

create policy people_insert_owner on public.people
  for insert to authenticated
  with check (private.is_household_owner(household_id));

create policy people_update_owner on public.people
  for update to authenticated
  using (private.is_household_owner(household_id))
  with check (private.is_household_owner(household_id));

create policy people_delete_owner on public.people
  for delete to authenticated
  using (private.is_household_owner(household_id));

-- ---- items -------------------------------------------------------------------
create policy items_select_member on public.items
  for select to authenticated
  using (private.is_household_member(household_id));

-- Any member may capture items. Non-owners must start at 'undecided' with an
-- empty decision triple; owners may capture-and-decide in one step (the
-- trigger stamps decided_by/decided_at either way).
create policy items_insert_member on public.items
  for insert to authenticated
  with check (
    private.is_household_member(household_id)
    and created_by = (select auth.uid())
    and (
      private.is_household_owner(household_id)
      or (decision = 'undecided' and decided_by is null and decided_at is null)
    )
  );

-- Row-level: any member may update (children enrich titles/rooms/values/notes
-- collaboratively). COLUMN-level authority over the decision triple is
-- enforced by the items_guard trigger — RLS cannot compare OLD vs NEW.
create policy items_update_member on public.items
  for update to authenticated
  using (private.is_household_member(household_id))
  with check (private.is_household_member(household_id));

-- Owners delete anything; a contributor may delete their own capture only
-- while it is still undecided (fixing a mistaken batch shot). Once the parent
-- has decided, the record is the parent's.
create policy items_delete on public.items
  for delete to authenticated
  using (
    private.is_household_owner(household_id)
    or (created_by = (select auth.uid()) and decision = 'undecided')
  );

-- ---- item_photos -------------------------------------------------------------
create policy item_photos_select_member on public.item_photos
  for select to authenticated
  using (private.is_household_member(private.item_household(item_id)));

create policy item_photos_insert_member on public.item_photos
  for insert to authenticated
  with check (
    private.is_household_member(private.item_household(item_id))
    and created_by = (select auth.uid())
  );

-- is_primary flips etc.
create policy item_photos_update_member on public.item_photos
  for update to authenticated
  using (private.is_household_member(private.item_household(item_id)))
  with check (private.is_household_member(private.item_household(item_id)));

create policy item_photos_delete on public.item_photos
  for delete to authenticated
  using (
    private.is_household_owner(private.item_household(item_id))
    or created_by = (select auth.uid())
  );

-- ---- item_tags ---------------------------------------------------------------
create policy item_tags_select_member on public.item_tags
  for select to authenticated
  using (private.is_household_member(private.item_household(item_id)));

create policy item_tags_insert_member on public.item_tags
  for insert to authenticated
  with check (private.is_household_member(private.item_household(item_id)));

create policy item_tags_delete_member on public.item_tags
  for delete to authenticated
  using (private.is_household_member(private.item_household(item_id)));
-- (no UPDATE policy: a tag row is just its PK; retag = delete + insert)

-- ---- stories -----------------------------------------------------------------
create policy stories_select_member on public.stories
  for select to authenticated
  using (private.is_household_member(private.item_household(item_id)));

create policy stories_insert_member on public.stories
  for insert to authenticated
  with check (
    private.is_household_member(private.item_household(item_id))
    and created_by = (select auth.uid())
  );

-- A story belongs to its teller; the owner can also curate.
create policy stories_update on public.stories
  for update to authenticated
  using (
    created_by = (select auth.uid())
    or private.is_household_owner(private.item_household(item_id))
  )
  with check (
    created_by = (select auth.uid())
    or private.is_household_owner(private.item_household(item_id))
  );

create policy stories_delete on public.stories
  for delete to authenticated
  using (
    created_by = (select auth.uid())
    or private.is_household_owner(private.item_household(item_id))
  );

-- ---- audit_log ---------------------------------------------------------------
-- SELECT: owners only ("surfaced to the owner", spec §4/§7).
-- INSERT/UPDATE/DELETE: no policies at all + privileges revoked below —
-- the only write path is private.log_audit() via triggers.
create policy audit_log_select_owner on public.audit_log
  for select to authenticated
  using (private.is_household_owner(household_id));


-- =============================================================================
-- 7. STORAGE — private `item-photos` bucket
-- =============================================================================
-- Path convention:  {household_id}/{item_id}/{filename}
--
-- Upload pipeline (spec §7): the client NEVER writes to storage directly.
-- Photos go to an Edge Function which strips EXIF/GPS server-side, then
-- uploads with the service role (bypasses RLS) and inserts the item_photos
-- metadata row with exif_stripped = true. Hence there are deliberately NO
-- insert/update policies for `authenticated` on this bucket — absence of a
-- policy is the enforcement.
--
-- Delivery: short-lived signed URLs only (bucket is private, no public URLs
-- in v1 — not even opt-in). The SELECT policy below is what authorizes a
-- member's createSignedUrl() call for their household's objects.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'item-photos', 'item-photos', false,
  20 * 1024 * 1024,                                   -- 20 MB per photo/audio blob
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'audio/m4a', 'audio/mp4', 'audio/mpeg', 'audio/webm']
)
on conflict (id) do nothing;

-- NOTE: on hosted Supabase, policies on storage.objects must be created by a
-- role with ownership rights (supabase db push runs as postgres, which works
-- on current projects; if this section errors with "must be owner", apply
-- these two policies via the dashboard Storage policies UI instead).

-- Members may read (i.e., sign URLs for) objects under their household prefix.
create policy "item_photos_bucket_select_member" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'item-photos'
    and private.is_household_member(((storage.foldername(name))[1])::uuid)
  );

-- Owners may hard-delete objects (contributors delete via the metadata row /
-- an Edge Function, keeping bytes and rows in sync server-side).
create policy "item_photos_bucket_delete_owner" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'item-photos'
    and private.is_household_owner(((storage.foldername(name))[1])::uuid)
  );


-- =============================================================================
-- 8. PRIVILEGE HYGIENE (grants / revokes)
-- =============================================================================
-- Declutter has no anonymous surface at all — every screen is behind auth — so
-- anon gets NOTHING on these tables (defense in depth on top of RLS, which
-- already has no anon policies). authenticated gets full DML and RLS decides
-- row by row; audit_log writes are additionally revoked at the privilege
-- level so even a future buggy policy could not open them up.

revoke all on all tables in schema public from anon;

grant select, insert, update, delete on all tables in schema public to authenticated;
revoke insert, update, delete on public.audit_log from authenticated;  -- read-only via RLS

-- `private` schema: callable but not creatable-in by API roles. Policies run
-- helper functions AS THE CALLING USER, so authenticated needs EXECUTE.
grant usage on schema private to authenticated;
revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;

-- The one intentional public RPC.
revoke all on function public.accept_invite(uuid) from public, anon;
grant execute on function public.accept_invite(uuid) to authenticated;

-- Keep future objects in `private` locked down by default.
alter default privileges in schema private revoke execute on functions from public;


-- =============================================================================
-- 9. PHASE 2 / PHASE 3 — deliberately deferred
-- =============================================================================
-- The following tables from spec §4 are NOT created in this migration. Their
-- enums (heir_visibility, request_status, legacy_status, legacy_trigger) and
-- their FK targets (people, items, households) already exist above, so adding
-- them later is pure CREATE TABLE + policies, no churn:
--
--   heir_assignments  (Phase 2) — owner-only writes; contributor reads
--                      filtered by visibility ('owner_only'/'after_death'/
--                      'revealed'); field-level encryption at rest.
--   item_requests     (Phase 2) — child interest signals; visible only to the
--                      requester + owner (no competitor visibility).
--   donations         (Phase 3) — tax-receipt records per donated item.
--   legacy_access     (Phase 3) — executor designation + death/incapacity
--                      verification before read-only unlock.
--
-- Also deferred to hardening: field-level encryption for market_value_cents
-- (pgsodium or app-layer), MFA gating on sensitive actions (Auth config, not
-- schema), and trusted-recovery-contact flows.
-- =============================================================================
