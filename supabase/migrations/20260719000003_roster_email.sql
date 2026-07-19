-- =============================================================================
-- DECLUTTER — migration 0003: invitations need somewhere to land.
-- roster_entries gains the invitee's email so an approved invitation can be
-- delivered (edge function `invite-member`) and later matched to the auth
-- user who accepts it.
-- =============================================================================

alter table public.roster_entries
  add column invited_email text
    check (invited_email is null or invited_email like '%_@_%._%');

comment on column public.roster_entries.invited_email is
  'Where the invitation is sent once a decider approves. Matched (case-insensitively) to the auth user on acceptance.';
