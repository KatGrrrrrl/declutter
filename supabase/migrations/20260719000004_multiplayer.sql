-- =============================================================================
-- DECLUTTER — migration 0004: multiplayer plumbing.
--   1. Realtime on items + item_messages (family devices see each other live)
--   2. my_pending_invites() — an invited person, once signed in, can discover
--      which households are waiting for them (their invited membership row is
--      not visible through normal RLS until they're active — this definer
--      function bridges exactly that gap, matching strictly on their own
--      verified JWT email).
-- =============================================================================

-- 1. Realtime publication (RLS still applies to subscribers).
alter publication supabase_realtime add table public.item_messages;
alter publication supabase_realtime add table public.items;

-- 2. Invite discovery for the signed-in user.
create or replace function public.my_pending_invites()
returns table (
  household_id uuid,
  household_name text,
  role public.household_role,
  invited_at timestamptz
)
language sql
security definer
set search_path = ''
stable
as $$
  select hm.household_id, h.name, hm.role, hm.invited_at
  from public.household_members hm
  join public.households h on h.id = hm.household_id
  where hm.status = 'invited'
    and hm.invited_email is not null
    and lower(hm.invited_email) = lower(coalesce(private.jwt_email(), ''));
$$;

revoke all on function public.my_pending_invites() from public, anon;
grant execute on function public.my_pending_invites() to authenticated;
