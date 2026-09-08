-- One-off cleanup, found during the 2026-09-07 end-to-end review.
-- Run in the Supabase SQL editor (Dashboard → SQL) as the postgres role.
-- Everything here is verified against the live data as of that date; re-check
-- the SELECTs at the bottom before/after.

begin;

-- 1. Two "Millrun" households. The phone is linked to the newer one
--    (8974781a…, created 2026-09-07 21:35 UTC); the July one (942f5389…)
--    has 0 items but still holds the three pending invitations that were
--    emailed to family. Move the invitations across, then retire the duplicate.
update public.household_members
   set household_id = '8974781a-8c9a-4904-8ac3-95af8c92ea82'
 where household_id = '942f5389-85e2-492d-927d-b0b43fdcea14'
   and status = 'invited';

delete from public.households
 where id = '942f5389-85e2-492d-927d-b0b43fdcea14';

-- 2. Leftovers from earlier test scripts whose cleanup silently failed.
delete from public.households
 where id in (
   '4e1abf3f-21f8-44d2-8d2a-6cb5eb2c950e', -- Email Test House
   'afea5ab2-8400-426a-b39a-6e639ac3e4ac', -- Email Test House
   '04e638e6-ffe8-4ac6-8cc7-3709d4869283', -- Probe House
   'ec4eb3d3-e3e5-4c6e-8b71-2177b97dcb60', -- E2E House
   'beb5880d-0ae9-4e12-9add-382fe7745f13'  -- E2E House
 );

-- Their throwaway accounts (all @example.com — no real person).
delete from auth.users
 where email like 'e2e-%@example.com' or email like 'probe-%@example.com';

commit;

-- Expect: exactly one Millrun, with 3 pending invitations and 1 active member;
-- no test households; no @example.com users.
select h.name, h.id,
       (select count(*) from public.household_members m where m.household_id = h.id and m.status = 'invited') as pending_invites,
       (select count(*) from public.household_members m where m.household_id = h.id and m.status = 'active')  as active_members
  from public.households h order by h.created_at desc;
select count(*) as example_com_users from auth.users where email like '%@example.com';
