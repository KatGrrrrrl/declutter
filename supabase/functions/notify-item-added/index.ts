/**
 * notify-item-added — the "instant" email path.
 *
 * POST { itemId, itemTitle, householdId, addedBy }
 *
 * Auth: verify_jwt is ON (default), but that only proves the request carries
 * a JWT the project signed — and the public anon key IS such a JWT. So the
 * caller must also resolve to a real user who is an ACTIVE member of the
 * household; anything else is refused. Before this check, anyone holding the
 * app's publishable key could make the server email every instant subscriber
 * of any household whose id they knew, with a title and "added by" name of
 * their choosing. The caller's own user id is excluded from the fanout:
 * nobody needs an email about the item they just added themselves.
 *
 * Fanout: notification_prefs rows for the household with mode = 'instant'
 * (service role read; the (household_id, mode) index makes this one scan).
 *
 * Delivery: Resend (https://resend.com). `inventoryourhouse.com` is a
 * verified sending domain (DKIM at resend._domainkey, bounce CNAMEs on
 * send/rsend, DMARC p=none), so mail goes out as hello@ to any recipient.
 * Do NOT revert the from-address to `onboarding@resend.dev`: that sandbox
 * sender only ever reached the Resend account owner's own inbox. Until
 * `supabase secrets set RESEND_API_KEY=…` is run, this function fails
 * gracefully with 503 email_not_configured and the app carries on — email
 * is an enhancement, never a dependency.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

const RESEND_URL = 'https://api.resend.com/emails';
const FROM = 'Inventory Our Home <hello@inventoryourhouse.com>'; // verified sending domain (see header note)
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
    const fallbackTitle = typeof itemTitle === 'string' && itemTitle.trim() ? itemTitle.trim() : 'New item';
    const fallbackWho = typeof addedBy === 'string' && addedBy.trim() ? addedBy.trim() : 'Someone';

    const apiKey = Deno.env.get('RESEND_API_KEY');
    if (!apiKey) {
      // No email provider wired up yet — honest, non-fatal.
      return Response.json({ ok: false, error: 'email_not_configured' }, { status: 503, headers: cors });
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Who is calling, and do they belong to this household?
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: userData } = await admin.auth.getUser(token);
    const callerId = userData?.user?.id ?? null;
    if (!callerId) {
      return Response.json({ ok: false, error: 'Not signed in.' }, { status: 401, headers: cors });
    }
    const { data: membership } = await admin
      .from('household_members')
      .select('id, display_name')
      .eq('household_id', householdId)
      .eq('user_id', callerId)
      .eq('status', 'active')
      .maybeSingle();
    if (!membership) {
      return Response.json(
        { ok: false, error: 'Not a member of that household.' },
        { status: 403, headers: cors }
      );
    }

    // What the email says comes from the database where it can: the name the
    // household knows the caller by, and the item's stored title. The request
    // body is only a fallback (an item not yet uploaded, a member with no
    // display name) — otherwise any member could send the family an email
    // "from" someone else about an item that doesn't exist.
    let title = fallbackTitle;
    if (typeof itemId === 'string' && /^[0-9a-f-]{36}$/i.test(itemId)) {
      const { data: stored } = await admin
        .from('items')
        .select('title')
        .eq('id', itemId)
        .eq('household_id', householdId)
        .maybeSingle();
      if (stored?.title?.trim()) title = stored.title.trim();
    }
    const who = membership.display_name?.trim() || fallbackWho;

    const { data: hh } = await admin
      .from('households')
      .select('name')
      .eq('id', householdId)
      .maybeSingle();
    const householdName = hh?.name ?? 'your household';

    const { data: prefs, error: prefsError } = await admin
      .from('notification_prefs')
      .select('user_id, email')
      .eq('household_id', householdId)
      .eq('mode', 'instant')
      .neq('user_id', callerId);
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
