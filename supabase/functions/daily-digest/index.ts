/**
 * daily-digest — the "one email each evening" path.
 *
 * Meant to be invoked by a scheduler (pg_cron + pg_net, or any external cron)
 * once a day, not by app users — so it is deployed with --no-verify-jwt.
 * INSTEAD of a JWT, the gate is a shared secret: every request must carry the
 * header `x-digest-secret` matching the DIGEST_SECRET function secret, and
 * anything else gets 401. (A scheduler holds no user session, so a JWT check
 * would be meaningless here; the secret header is the auth.) Set it with:
 *   supabase secrets set DIGEST_SECRET=<long random string>
 * Unset DIGEST_SECRET fails CLOSED (401 for everyone).
 *
 * For each household with mode='daily' subscribers, collects items created in
 * the last 24 hours and mails each subscriber a short list (title · room ·
 * added date). Households with nothing new send nothing — no empty emails.
 *
 * Delivery: Resend, same handling as notify-item-added — sandbox sender
 * `onboarding@resend.dev` until a domain is verified, and a graceful
 * 503 email_not_configured until RESEND_API_KEY is set.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

const RESEND_URL = 'https://api.resend.com/emails';
const FROM = 'Inventory Our Home <onboarding@resend.dev>'; // Resend sandbox sender (see header note)
const APP_URL = 'https://inventoryourhouse.com';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-digest-secret',
};

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

interface DigestRow {
  title: string | null;
  room: string | null;
  created_at: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  // --- the gate: shared secret instead of a JWT (see header comment) ---
  const secret = Deno.env.get('DIGEST_SECRET');
  const given = req.headers.get('x-digest-secret');
  if (!secret || !given || given !== secret) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401, headers: cors });
  }

  try {
    const apiKey = Deno.env.get('RESEND_API_KEY');
    if (!apiKey) {
      return Response.json({ ok: false, error: 'email_not_configured' }, { status: 503, headers: cors });
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Everyone, everywhere, who asked for a daily summary — grouped by household.
    const { data: prefs, error: prefsError } = await admin
      .from('notification_prefs')
      .select('household_id, email')
      .eq('mode', 'daily');
    if (prefsError) {
      return Response.json({ ok: false, error: prefsError.message }, { status: 500, headers: cors });
    }

    const byHousehold = new Map<string, string[]>();
    for (const p of prefs ?? []) {
      const list = byHousehold.get(p.household_id) ?? [];
      list.push(p.email);
      byHousehold.set(p.household_id, list);
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    let households = 0;
    let emails = 0;
    let failed = 0;

    // Sequential on purpose: digests are a once-a-day batch, and dribbling
    // requests is kind to both the DB and Resend's rate limits.
    for (const [householdId, recipients] of byHousehold) {
      const { data: items } = await admin
        .from('items')
        .select('title, room, created_at')
        .eq('household_id', householdId)
        .gte('created_at', since)
        .order('created_at', { ascending: false });
      if (!items?.length) continue; // quiet day, no email

      const { data: hh } = await admin
        .from('households')
        .select('name')
        .eq('id', householdId)
        .maybeSingle();
      const householdName = hh?.name ?? 'your household';

      const rows = (items as DigestRow[])
        .map((i) => {
          const added = new Date(i.created_at).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
          });
          const bits = [
            `<strong>${escapeHtml(i.title?.trim() || 'New item')}</strong>`,
            i.room ? escapeHtml(i.room) : null,
            `added ${added}`,
          ].filter(Boolean);
          return `<li style="margin: 6px 0; font-size: 15px; line-height: 1.5;">${bits.join(' &middot; ')}</li>`;
        })
        .join('');

      const count = items.length;
      const subject = `Inventory Our Home · ${householdName}: ${count} new ${count === 1 ? "item" : "items"} today`;
      const html = `
        <div style="font-family: Georgia, 'Times New Roman', serif; color: #2b2620; max-width: 520px; margin: 0 auto; padding: 24px;">
          <p style="font-size: 17px; line-height: 1.55;">
            Here&rsquo;s what the family added to
            <strong>${escapeHtml(householdName)}</strong> in the last day:
          </p>
          <ul style="padding-left: 20px; margin: 12px 0;">${rows}</ul>
          <p style="font-size: 15px;">
            <a href="${APP_URL}" style="color: #8a6d2f;">Open Inventory Our Home to take a look</a>
          </p>
          <p style="font-size: 12.5px; color: #9a9082; line-height: 1.5;">
            You chose a daily summary for this household. Switch to instant
            updates — or turn emails off — any time in Settings &rarr; Email updates.
          </p>
        </div>`;

      households += 1;
      for (const to of recipients) {
        const res = await fetch(RESEND_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: FROM, to: [to], subject, html }),
        });
        if (res.ok) emails += 1;
        else failed += 1;
      }
    }

    return Response.json({ ok: true, households, emails, failed }, { headers: cors });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error: msg }, { status: 500, headers: cors });
  }
});
