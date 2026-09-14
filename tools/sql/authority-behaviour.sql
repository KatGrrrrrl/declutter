-- =============================================================================
-- Authority behaviour suite — who may do what, proven against the real rules.
--
-- Run against any database that has migrations through 017 applied:
--   psql "<connection>" -v ON_ERROR_STOP=1 -q -tA -f tools/sql/authority-behaviour.sql 2>&1 \
--     | grep -E "PASS|FAIL"
--
-- Everything happens inside one transaction that ends in ROLLBACK: it mints
-- throwaway accounts and a throwaway household, acts as each account through
-- RLS (role authenticated + a forged JWT claim), and leaves nothing behind.
-- It needs a superuser-ish connection (to insert into auth.users and switch
-- roles) — the pooler's `postgres.<ref>` user is enough. Never point it at a
-- database where a rollback isn't guaranteed.
--
-- Every test prints exactly one PASS or FAIL line. A FAIL is a real authority
-- bug, not flakiness.
-- =============================================================================

begin;

-- ---- fixtures ---------------------------------------------------------------
-- O: owner (creates the home)   H: helper (invited contributor)
-- D: decider (invited co_owner) X: outsider (belongs to nothing)
insert into auth.users (id, email, aud, role, email_confirmed_at, created_at, updated_at)
values
  ('a0000000-0000-4000-8000-000000000001', 'authz-owner@test.invalid',    'authenticated', 'authenticated', now(), now(), now()),
  ('a0000000-0000-4000-8000-000000000002', 'authz-helper@test.invalid',   'authenticated', 'authenticated', now(), now(), now()),
  ('a0000000-0000-4000-8000-000000000003', 'authz-decider@test.invalid',  'authenticated', 'authenticated', now(), now(), now()),
  ('a0000000-0000-4000-8000-000000000004', 'authz-outsider@test.invalid', 'authenticated', 'authenticated', now(), now(), now());

insert into public.households (id, name, created_by)
values ('b0000000-0000-4000-8000-000000000001', 'Authz Test Home', 'a0000000-0000-4000-8000-000000000001');

insert into public.household_members (household_id, invited_email, role, status, invited_by)
values
  ('b0000000-0000-4000-8000-000000000001', 'authz-helper@test.invalid',  'contributor', 'invited', 'a0000000-0000-4000-8000-000000000001'),
  ('b0000000-0000-4000-8000-000000000001', 'authz-decider@test.invalid', 'co_owner',    'invited', 'a0000000-0000-4000-8000-000000000001');

do $t$ begin
  if (select is_admin from public.household_members
       where household_id = 'b0000000-0000-4000-8000-000000000001'
         and user_id = 'a0000000-0000-4000-8000-000000000001') then
    raise notice 'PASS 00 the creator of a home administers it from the start';
  else
    raise notice 'FAIL 00 the creator of a home is not its administrator';
  end if;
end $t$;


-- ---- as the outsider ---------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000004","email":"authz-outsider@test.invalid","role":"authenticated"}', true);
set local role authenticated;

do $t$ declare n int; begin
  select count(*) into n from public.household_members where household_id = 'b0000000-0000-4000-8000-000000000001';
  raise notice '% 01 an outsider sees none of the home''s members (% visible)', case when n = 0 then 'PASS' else 'FAIL' end, n;
end $t$;

do $t$ begin
  begin
    insert into public.items (household_id, created_by, title)
    values ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000004', 'Intruder');
    raise notice 'FAIL 02 an outsider added an item to someone else''s home';
  exception when others then raise notice 'PASS 02 an outsider cannot add items: %', sqlerrm;
  end;
end $t$;


-- ---- as the helper: accepting ------------------------------------------------
reset role;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","email":"authz-helper@test.invalid","role":"authenticated"}', true);
set local role authenticated;

do $t$ declare n int; begin
  begin
    update public.household_members
       set status = 'active', user_id = 'a0000000-0000-4000-8000-000000000002', role = 'owner'
     where household_id = 'b0000000-0000-4000-8000-000000000001' and invited_email = 'authz-helper@test.invalid';
    get diagnostics n = row_count;
    raise notice '% 03 accepting an invitation cannot make you owner (% rows changed)', case when n = 0 then 'PASS' else 'FAIL' end, n;
  exception when others then raise notice 'PASS 03 accepting an invitation cannot make you owner: %', sqlerrm;
  end;
end $t$;

do $t$ declare n int; begin
  begin
    update public.household_members
       set status = 'active', user_id = 'a0000000-0000-4000-8000-000000000002', is_admin = true
     where household_id = 'b0000000-0000-4000-8000-000000000001' and invited_email = 'authz-helper@test.invalid';
    get diagnostics n = row_count;
    raise notice '% 04 accepting an invitation cannot make you administrator (% rows changed)', case when n = 0 then 'PASS' else 'FAIL' end, n;
  exception when others then raise notice 'PASS 04 accepting an invitation cannot make you administrator: %', sqlerrm;
  end;
end $t$;

do $t$ declare r uuid; begin
  r := public.accept_invite('b0000000-0000-4000-8000-000000000001');
  raise notice 'PASS 05 a helper can accept their own invitation normally';
exception when others then raise notice 'FAIL 05 a helper could not accept their invitation: %', sqlerrm;
end $t$;


-- ---- as the helper: a plain contributor --------------------------------------
do $t$ declare n int; begin
  update public.household_members set display_name = 'Helper'
   where household_id = 'b0000000-0000-4000-8000-000000000001' and user_id = 'a0000000-0000-4000-8000-000000000002';
  get diagnostics n = row_count;
  raise notice '% 06 a member can set their own display name (% rows)', case when n = 1 then 'PASS' else 'FAIL' end, n;
exception when others then raise notice 'FAIL 06 a member could not set their own display name: %', sqlerrm;
end $t$;

do $t$ declare n int; begin
  begin
    update public.household_members set invited_email = 'someone-else@test.invalid'
     where household_id = 'b0000000-0000-4000-8000-000000000001' and user_id = 'a0000000-0000-4000-8000-000000000002';
    get diagnostics n = row_count;
    raise notice '% 06b a member cannot rewrite the address they were invited at (% rows changed)', case when n = 0 then 'PASS' else 'FAIL' end, n;
  exception when others then raise notice 'PASS 06b a member cannot rewrite the address they were invited at: %', sqlerrm;
  end;
end $t$;

do $t$ declare n int; begin
  begin
    update public.household_members set role = 'co_owner'
     where household_id = 'b0000000-0000-4000-8000-000000000001' and user_id = 'a0000000-0000-4000-8000-000000000002';
    get diagnostics n = row_count;
    raise notice '% 06c editing your own membership cannot give you the final say (% rows changed)', case when n = 0 then 'PASS' else 'FAIL' end, n;
  exception when others then raise notice 'PASS 06c editing your own membership cannot give you the final say: %', sqlerrm;
  end;
end $t$;

do $t$ begin
  begin
    insert into public.roster_entries (household_id, name, is_decider)
    values ('b0000000-0000-4000-8000-000000000001', 'Self-appointed', true);
    raise notice 'FAIL 07 a helper wrote a roster line with the final say';
  exception when others then raise notice 'PASS 07 a helper cannot write a roster line with the final say: %', sqlerrm;
  end;
end $t$;

do $t$ declare n int; begin
  insert into public.roster_entries (household_id, name) values ('b0000000-0000-4000-8000-000000000001', 'Suggested person');
  get diagnostics n = row_count;
  raise notice '% 08 a helper can still suggest a name-only person (% rows)', case when n = 1 then 'PASS' else 'FAIL' end, n;
exception when others then raise notice 'FAIL 08 a helper could not suggest a person: %', sqlerrm;
end $t$;

do $t$ declare n int; begin
  begin
    update public.household_members set status = 'revoked'
     where household_id = 'b0000000-0000-4000-8000-000000000001' and invited_email = 'authz-decider@test.invalid';
    get diagnostics n = row_count;
    raise notice '% 09 a plain helper cannot withdraw someone''s invitation (% rows changed)', case when n = 0 then 'PASS' else 'FAIL' end, n;
  exception when others then raise notice 'PASS 09 a plain helper cannot withdraw someone''s invitation: %', sqlerrm;
  end;
end $t$;

do $t$ declare n int; begin
  insert into public.items (id, household_id, created_by, title, decision)
  values ('c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 'Helper capture', 'undecided');
  get diagnostics n = row_count;
  raise notice '% 10 a helper can capture an undecided item (% rows)', case when n = 1 then 'PASS' else 'FAIL' end, n;
exception when others then raise notice 'FAIL 10 a helper could not capture an item: %', sqlerrm;
end $t$;

do $t$ declare n int; begin
  begin
    update public.items set decision = 'keep' where id = 'c0000000-0000-4000-8000-000000000001';
    get diagnostics n = row_count;
    raise notice '% 11 a helper cannot decide an item, even their own (% rows changed)', case when n = 0 then 'PASS' else 'FAIL' end, n;
  exception when others then raise notice 'PASS 11 a helper cannot decide an item, even their own: %', sqlerrm;
  end;
end $t$;


-- ---- as the owner ------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","email":"authz-owner@test.invalid","role":"authenticated"}', true);
set local role authenticated;

do $t$ declare n int; begin
  insert into public.items (id, household_id, created_by, title)
  values ('c0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Owner item');
  update public.items set decision = 'keep' where id = 'c0000000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  raise notice '% 12 the owner can decide the helper''s item (% rows)', case when n = 1 then 'PASS' else 'FAIL' end, n;
exception when others then raise notice 'FAIL 12 the owner could not decide an item: %', sqlerrm;
end $t$;

do $t$ begin
  begin
    update public.items set main_decider = 'a0000000-0000-4000-8000-000000000002'
     where id = 'c0000000-0000-4000-8000-000000000002';
    raise notice 'FAIL 13 a helper was accepted as an item''s main decider';
  exception when others then raise notice 'PASS 13 only a real decider can be an item''s main decider: %', sqlerrm;
  end;
end $t$;


-- ---- as the helper: nothing to delete yet ------------------------------------
reset role;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","email":"authz-helper@test.invalid","role":"authenticated"}', true);
set local role authenticated;

do $t$ declare n int; begin
  delete from public.items where id = 'c0000000-0000-4000-8000-000000000002';
  get diagnostics n = row_count;
  raise notice '% 14 a plain helper cannot delete the owner''s item (% rows)', case when n = 0 then 'PASS' else 'FAIL' end, n;
end $t$;


-- ---- the owner makes the helper an administrator -----------------------------
reset role;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","email":"authz-owner@test.invalid","role":"authenticated"}', true);
set local role authenticated;

do $t$ declare n int; begin
  update public.household_members set is_admin = true
   where household_id = 'b0000000-0000-4000-8000-000000000001' and user_id = 'a0000000-0000-4000-8000-000000000002';
  get diagnostics n = row_count;
  raise notice '% 15 the owner can make someone an administrator (% rows)', case when n = 1 then 'PASS' else 'FAIL' end, n;
exception when others then raise notice 'FAIL 15 the owner could not grant administrator standing: %', sqlerrm;
end $t$;


-- ---- as the helper, now administrator ----------------------------------------
reset role;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","email":"authz-helper@test.invalid","role":"authenticated"}', true);
set local role authenticated;

do $t$ begin
  begin
    update public.household_members set role = 'co_owner'
     where household_id = 'b0000000-0000-4000-8000-000000000001' and user_id = 'a0000000-0000-4000-8000-000000000002';
    raise notice 'FAIL 16 an administrator gave themselves the final say';
  exception when others then raise notice 'PASS 16 an administrator cannot give themselves the final say: %', sqlerrm;
  end;
end $t$;

do $t$ begin
  begin
    update public.items set decision = 'donate' where id = 'c0000000-0000-4000-8000-000000000002';
    if (select decision from public.items where id = 'c0000000-0000-4000-8000-000000000002') = 'donate' then
      raise notice 'FAIL 17 an administrator decided an item';
    else
      raise notice 'PASS 17 administering a home grants no decisions';
    end if;
  exception when others then raise notice 'PASS 17 administering a home grants no decisions: %', sqlerrm;
  end;
end $t$;

do $t$ declare n int; begin
  update public.household_members set status = 'revoked'
   where household_id = 'b0000000-0000-4000-8000-000000000001' and invited_email = 'authz-decider@test.invalid';
  get diagnostics n = row_count;
  raise notice '% 18 an administrator can withdraw an invitation (% rows)', case when n = 1 then 'PASS' else 'FAIL' end, n;
exception when others then raise notice 'FAIL 18 an administrator could not withdraw an invitation: %', sqlerrm;
end $t$;

do $t$ declare n int; begin
  delete from public.items where id = 'c0000000-0000-4000-8000-000000000002';
  get diagnostics n = row_count;
  raise notice '% 19 an administrator can remove an item (% rows)', case when n = 1 then 'PASS' else 'FAIL' end, n;
end $t$;

do $t$ declare n int; begin
  insert into public.item_messages (item_id, author, author_name, body, household_id)
  values ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 'Helper', 'hello',
          'b0000000-0000-4000-8000-00000000ffff');
  get diagnostics n = row_count;
  raise notice '% 20 a chat message is accepted (% rows)', case when n = 1 then 'PASS' else 'FAIL' end, n;
exception when others then raise notice 'FAIL 20 a chat message was refused: %', sqlerrm;
end $t$;


-- ---- as the owner: the last administrator ------------------------------------
reset role;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","email":"authz-owner@test.invalid","role":"authenticated"}', true);
set local role authenticated;

do $t$ declare n int; begin
  update public.household_members set is_admin = false
   where household_id = 'b0000000-0000-4000-8000-000000000001' and user_id = 'a0000000-0000-4000-8000-000000000002';
  get diagnostics n = row_count;
  raise notice '% 21 the owner can remove someone''s administrator standing (% rows)', case when n = 1 then 'PASS' else 'FAIL' end, n;
exception when others then raise notice 'FAIL 21 could not remove administrator standing: %', sqlerrm;
end $t$;

do $t$ begin
  begin
    update public.household_members set is_admin = false
     where household_id = 'b0000000-0000-4000-8000-000000000001' and user_id = 'a0000000-0000-4000-8000-000000000001';
    raise notice 'FAIL 22 the last administrator was removed';
  exception when others then raise notice 'PASS 22 a home always keeps an administrator: %', sqlerrm;
  end;
end $t$;


-- ---- unforgeable server-side stamps ------------------------------------------
reset role;
do $t$ begin
  if (select household_id from public.item_messages where item_id = 'c0000000-0000-4000-8000-000000000001')
     = 'b0000000-0000-4000-8000-000000000001' then
    raise notice 'PASS 23 a chat message is filed under its item''s real household, whatever the app sends';
  else
    raise notice 'FAIL 23 a chat message kept the household the app sent';
  end if;
end $t$;

rollback;
