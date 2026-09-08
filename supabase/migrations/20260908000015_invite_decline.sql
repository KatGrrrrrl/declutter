-- =============================================================================
-- DECLINING AN INVITATION
--
-- Until now the invite state machine had exactly one exit the invitee could
-- take: accept_invite(). Someone who signed in, found a household waiting for
-- them and did NOT want to join had no way to say so — the invitation sat
-- there indefinitely and the family that sent it never learned the answer.
--
-- decline_invite() is that second exit, and it is deliberately the mirror
-- image of accept_invite(): the same SECURITY DEFINER shape, the same "matched
-- strictly against your own verified JWT email" rule, and the same reliance on
-- members_guard for the real authority check (invited -> revoked is already a
-- legal transition there, so nothing new is being permitted here).
--
-- Three things happen together, which is precisely why this is one RPC rather
-- than three client calls that could each fail on their own:
--   1. the membership invitation is revoked, and stamped `declined_at` so a
--      decline stays distinguishable from an invitation the household itself
--      withdrew — both land on status 'revoked';
--   2. the ROSTER line addressed to that email is revoked too. The roster is
--      what the family's devices actually render, so without this the person
--      would stay under "Waiting to join" forever, or simply vanish;
--   3. an audit line records it, because who was asked and who said no is part
--      of a household's history, not a transient UI event.
--
-- Telling the administrators is deliberately NOT done here. Email delivery
-- belongs to the notify-invite-declined Edge Function, which reads the
-- `declined_at` stamp this function writes as its proof that the caller is
-- entitled to make it send.
-- =============================================================================

alter table public.household_members
  add column declined_at timestamptz;

comment on column public.household_members.declined_at is
  'Set when the INVITEE turned the invitation down (status goes to revoked at '
  'the same time). Null on an invitation the household revoked itself.';

create or replace function public.decline_invite(p_household_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id    uuid;
  v_email text := private.jwt_email();
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required';
  end if;
  -- No verified email, no claim on any invitation: invitations are addressed
  -- to an address, and that address is the only thing that identifies them.
  if v_email = '' then
    raise exception 'a verified email is required to decline an invitation';
  end if;

  update public.household_members m
     set status = 'revoked',
         declined_at = now()
   where m.household_id = p_household_id
     and m.status = 'invited'
     and lower(m.invited_email) = v_email
  returning m.id into v_id;

  if v_id is null then
    raise exception 'no pending invite for this account';
  end if;

  -- Matched by email and never by name: the roster names the person as the
  -- family knows them ("Mum", "Sam"), which is not necessarily anything the
  -- invitee has ever typed themselves.
  update public.roster_entries r
     set status = 'revoked'
   where r.household_id = p_household_id
     and r.status = 'invited'
     and lower(r.invited_email) = v_email;

  perform private.log_audit(p_household_id, 'member.declined', 'member', v_id,
    jsonb_build_object('invited_email', v_email));

  return v_id;
end;
$$;

revoke all on function public.decline_invite(uuid) from public, anon;
grant execute on function public.decline_invite(uuid) to authenticated;
