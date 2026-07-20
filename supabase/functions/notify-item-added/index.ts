/**
 * notify-item-added — the "instant" email path.
 *
 * POST { itemId, itemTitle, householdId, addedBy }
 *
 * Auth: verify_jwt is ON (default) — only signed-in app users can call this.
 * The caller's own user id (from their JWT) is EXCLUDED from the fanout:
 * nobody needs an email about the item they just added themselves.
 *
 * Fanout: notification_prefs rows for the household with mode = 'instant'
 * (service role read; the (household_id, mode) index makes this one scan).
 *
 * Delivery: Resend (https://resend.com). Until a sending domain is verified
 * in the Resend dashboard, the only allowed from-address is their shared
 * `onboarding@resend.dev` — swap it for e.g. `hello@inventoryourhouse.com`
 * once the domain is verified. Until `supabase secrets set RESEND_API_KEY=…`
 * is run, this function fails gracefully with 503 email_not_configured and
 * the app carries on — email is an enhancement, never a dependency.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

const RESEND_URL = 'https://api.resend.com/emails';
const FROM = 'Inventory Our Home <onboarding@resend.dev>'; // Resend sandbox sender (see header note)
const APP_URL = 'https://inventoryourhouse.com';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const { itemId, itemTitle, householdId, addedBy } = await req.json();
    if (!householdId || typeof householdId !== 'string') {
      return Response.json({ ok: false, error: 'householdId is required.' }, { status: 400, headers: cors });
    }
    const title = typeof itemTitle === 'string' && itemTitle.trim() ? itemTitle.trim() : 'New item';
    const who = typeof addedBy === 'string' && addedBy.trim() ? addedBy.trim() : 'Someone';

    const apiKey = Deno.env.get('RESEND_API_KEY');
    if (!apiKey) {
      // No email provider wired up yet — honest, non-fatal.
      return Response.json({ ok: false, error: 'email_not_configured' }, { status: 503, headers: cors });
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Who is calling? (verify_jwt already validated the token; we only need
    // the uid so the adder never emails themselves.)
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: userData } = await admin.auth.getUser(token);
    const callerId = userData?.user?.id ?? null;

    const { data: hh } = await admin
      .from('households')
      .select('name')
      .eq('id', householdId)
      .maybeSingle();
    const householdName = hh?.name ?? 'your household';

    let query = admin
      .from('notification_prefs')
      .select('user_id, email')
      .eq('household_id', householdId)
      .eq('mode', 'instant');
    if (callerId) query = query.neq('user_id', callerId);
    const { data: prefs, error: prefsError } = await query;
    if (prefsError) {
      return Response.json({ ok: false, error: prefsError.message }, { status: 500, headers: cors });
    }

    const subject = `Inventory Our Home · ${who} added "${title}" to ${householdName}`;
    const html = `
      <div style="font-family: Georgia, 'Times New Roman', serif; color: #2b2620; max-width: 520px; margin: 0 auto; padding: 24px;">
        <p style="font-size: 17px; line-height: 1.55;">
          <strong>${escapeHtml(who)}</strong> just added
          <strong>&ldquo;${escapeHtml(title)}&rdquo;</strong> to
          <strong>${escapeHtml(householdName)}</strong>.
        </p>
        <p style="font-size: 15px; line-height: 1.55; color: #6b6257;">
          Every item tells a little of the family story — take a peek when you have a moment.
        </p>
        <p style="font-size: 15px;">
          <a href="${APP_URL}" style="color: #8a6d2f;">Open Inventory Our Home</a>
        </p>
        <p style="font-size: 12.5px; color: #9a9082; line-height: 1.5;">
          You chose instant updates for this household. You can switch to a daily
          summary — or turn emails off — any time in Settings &rarr; Email updates.
        </p>
      </div>`;

    let sent = 0;
    let failed = 0;
    // Sequential on purpose — tiny volumes, and kind to rate limits.
    for (const p of prefs ?? []) {
      const res = await fetch(RESEND_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: FROM, to: [p.email], subject, html }),
      });
      if (res.ok) sent += 1;
      else failed += 1;
    }

    return Response.json(
      { ok: true, itemId: itemId ?? null, recipients: (prefs ?? []).length, sent, failed },
      { headers: cors }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error: msg }, { status: 500, headers: cors });
  }
});
