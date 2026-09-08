-- =============================================================================
-- Schedule the daily-digest email. Settings has offered "Daily summary" since
-- notification_prefs shipped, but nothing ever invoked the daily-digest Edge
-- Function — the option was dead. pg_cron + pg_net call it once a day.
--
-- The function is gated by a shared secret (x-digest-secret). That secret is
-- GENERATED HERE, inside the database, and stored in Vault: it never appears
-- in git, a terminal, or a chat transcript. The function verifies the header
-- through public.check_digest_secret(), a SECURITY DEFINER function only the
-- service role may execute (the function runs with the service role). An
-- optional DIGEST_SECRET function secret still works as an override.
-- =============================================================================

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

grant usage on schema cron to postgres;

-- One secret, created once; re-running this migration keeps the existing one
-- (rotating it is a deliberate manual step, not a side effect of a deploy).
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'digest_secret') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'digest_secret',
      'Shared secret the daily-digest Edge Function requires in x-digest-secret'
    );
  end if;
end;
$$;

-- Called by the Edge Function (service role) to verify the header it received.
create or replace function public.check_digest_secret(p_secret text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1 from vault.decrypted_secrets
    where name = 'digest_secret' and decrypted_secret = p_secret
  );
$$;

revoke all on function public.check_digest_secret(text) from public, anon, authenticated;
grant execute on function public.check_digest_secret(text) to service_role;

-- Every evening at 23:00 UTC (7pm Toronto in summer, 6pm in winter).
select cron.unschedule(jobid) from cron.job where jobname = 'daily-digest';
select cron.schedule(
  'daily-digest',
  '0 23 * * *',
  $$
  select net.http_post(
    url     := 'https://xkzuoogmcfrxicmoybzp.supabase.co/functions/v1/daily-digest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-digest-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'digest_secret')
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
