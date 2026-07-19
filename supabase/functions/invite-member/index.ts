/**
 * invite-member — sends a real invitation email after a decider approves.
 *
 * Auth: verify_jwt is on (default), so only signed-in app users can call this.
 * Delivery: Supabase Auth's admin invite — creates (or reuses) the auth user
 * for the invitee and emails them a sign-in link that lands on the web app.
 *
 * Beta hardening notes (deliberate, documented):
 * - The caller must be signed in, but cloud-side "is caller a decider of that
 *   household" enforcement arrives with the real membership-accept flow.
 * - Built-in mailer rate limits apply (a few/hour on free tier) — fine for
 *   beta; custom SMTP before launch.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

Deno.serve(async (req) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const { email, name, householdName, invitedBy } = await req.json();
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return Response.json({ ok: false, error: 'A valid email is required.' }, { status: 400, headers: cors });
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { error } = await admin.auth.admin.inviteUserByEmail(email.trim().toLowerCase(), {
      redirectTo: 'https://inventoryourhouse.com',
      data: {
        invited_name: name ?? null,
        invited_to_household: householdName ?? null,
        invited_by: invitedBy ?? null,
      },
    });

    // "User already registered" is fine — they can just sign in normally.
    if (error && !/already.*(registered|exists)/i.test(error.message)) {
      return Response.json({ ok: false, error: error.message }, { status: 400, headers: cors });
    }

    return Response.json(
      { ok: true, alreadyRegistered: Boolean(error) },
      { headers: cors }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error: msg }, { status: 500, headers: cors });
  }
});
