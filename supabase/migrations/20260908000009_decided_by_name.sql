-- =============================================================================
-- items.decided_by_name — who made the call, as a display name.
--
-- decided_by is a uuid, and nothing a member can read maps another member's
-- uuid to a name (auth.users is private; roster_entries has no user_id). So a
-- decision made on one device arrived on every other device nameless — the
-- "New" badge showed without "· Rose". The deciding client sends its own
-- display name alongside the decision; it is cosmetic, so client-supplied is
-- fine. items_guard still owns decided_by/decided_at.
-- =============================================================================

alter table public.items
  add column if not exists decided_by_name text;

comment on column public.items.decided_by_name is
  'Display name of the decider, sent by the deciding client. Cosmetic; decided_by is the authority.';

-- Keep it in step with the decision: an undecided item has no decider name.
create or replace function private.items_decided_by_name_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.decision = 'undecided' then
    new.decided_by_name := null;
  end if;
  return new;
end;
$$;

drop trigger if exists items_decided_by_name_guard on public.items;
create trigger items_decided_by_name_guard
  before insert or update on public.items
  for each row execute function private.items_decided_by_name_guard();
