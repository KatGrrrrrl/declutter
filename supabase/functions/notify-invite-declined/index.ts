/**
 * notify-invite-declined — tells a household's administrators that someone
 * they invited has said no.
 *
 * POST { householdId }
 *
 * Auth: verify_jwt is ON (default), so the caller is a signed-in app user.
 * That alone is not enough — any signed-in account could otherwise use this to
 * mail strangers. The real gate is the decline itself: the caller must own a
 * household_members row in that household that carries a `declined_at` stamp
 * against their own auth email. decline_invite() (migration 0015) writes that
 * stamp, so the proof is a side effect of the thing having actually happened.
 *
 * Recipients: whoever ADMINISTERS the household — active members with
 * `is_admin` (migration 017), which is the app's own answer to "who runs this
 * home". If none has an email on file it falls back to the active owners.
 * Addresses come from auth, never from a client-writable column. Nobody is
 * silently dropped.
 *
 * Delivery: Resend, exactly as notify-item-added. With no RESEND_API_KEY set
 * this returns 503 email_not_configured and the app carries on — the decline
 * is already recorded in the database either way, so email is an enhancement
 * and never a dependency.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

const RESEND_URL = 'https://api.resend.com/emails';
const FROM = 'Inventory Our Home <hello@inventoryourhouse.com>'; // verified sending domain
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
    const { householdId } = await req.json();
    if (!householdId || typeof householdId !== 'string') {
      return Response.json(
        { ok: false, error: 'householdId is required.' },
        { status: 400, headers: cors }
      );
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Who is calling, and did they really decline this household's invitation?
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: userData } = await admin.auth.getUser(token);
    const callerEmail = (userData?.user?.email ?? '').toLowerCase();
    if (!callerEmail) {
      return Response.json(
        { ok: false, error: 'A verified email is required.' },
        { status: 401, headers: cors }
      );
    }

    const { data: declined } = await admin
      .from('household_members')
      .select('id, invited_email, declined_at, display_name')
      .eq('household_id', householdId)
      .eq('invited_email', callerEmail)
      .not('declined_at', 'is', null)
      .maybeSingle();
    if (!declined) {
      return Response.json(
        { ok: false, error: 'No declined invitation for this account.' },
        { status: 403, headers: cors }
      );
    }

    const apiKey = Deno.env.get('RESEND_API_KEY');
    if (!apiKey) {
      return Response.json(
        { ok: false, error: 'email_not_configured' },
        { status: 503, headers: cors }
      );
    }

    const { data: hh } = await admin
      .from('households')
      .select('name')
      .eq('id', householdId)
      .maybeSingle();
    const householdName = hh?.name ?? 'your household';

    // The family's own name for the person who declined reads far better in
    // the email than their email address does.
    const invitedName: string | null = declined.display_name ?? null;

    const recipients = new Set<string>();
    const addEmailsOf = async (userIds: (string | null)[]) => {
      for (const id of userIds) {
        if (!id) continue;
        const { data: u } = await admin.auth.admin.getUserById(id);
        const addr = u?.user?.email?.toLowerCase();
        if (addr) recipients.add(addr);
      }
    };

    // 1. The administrators.
    const { data: admins } = await admin
      .from('household_members')
      .select('user_id')
      .eq('household_id', householdId)
      .eq('status', 'active')
      .eq('is_admin', true);
    await addEmailsOf((admins ?? []).map((a) => a.user_id));

    // 2. Fallback: the household's active owners.
    if (recipients.size === 0) {
      const { data: owners } = await admin
        .from('household_members')
        .select('user_id')
        .eq('household_id', householdId)
        .eq('status', 'active')
        .in('role', ['owner', 'co_owner']);
      await addEmailsOf((owners ?? []).map((o) => o.user_id));
    }

    // Never mail the decliner about their own decline.
    recipients.delete(callerEmail);
    if (recipients.size === 0) {
      return Response.json({ ok: true, recipients: 0, sent: 0, failed: 0 }, { headers: cors });
    }

    const who = invitedName ?? callerEmail;
    const subject = `Inventory Our Home · ${who} declined the invitation to ${householdName}`;
    const html = `
      <div style="font-family: Georgia, 'Times New Roman', serif; color: #2b2620; max-width: 520px; margin: 0 auto; padding: 24px;">
        <p style="font-size: 17px; line-height: 1.55;">
          <strong>${escapeHtml(who)}</strong> (${escapeHtml(callerEmail)}) has declined
          the invitation to join <strong>${escapeHtml(householdName)}</strong>.
        </p>
        <p style="font-size: 15px; line-height: 1.55; color: #6b6257;">
          They&rsquo;ve started a home of their own instead. Nothing in
          ${escapeHtml(householdName)} has changed, and you can invite them
          again any time from the Family screen if they change their mind.
        </p>
        <p style="font-size: 15px;">
          <a href="${APP_URL}" style="color: #8a6d2f;">Open Inventory Our Home</a>
        </p>
        <p style="font-size: 12.5px; color: #9a9082; line-height: 1.5;">
          You&rsquo;re receiving this because you administer ${escapeHtml(householdName)}.
        </p>
      </div>`;

    let sent = 0;
    let failed = 0;
    // Sequential on purpose — tiny volumes, and kind to rate limits.
    for (const to of recipients) {
      const res = await fetch(RESEND_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: FROM, to: [to], subject, html }),
      });
      if (res.ok) sent += 1;
      else failed += 1;
    }

    return Response.json(
      { ok: true, recipients: recipients.size, sent, failed },
      { headers: cors }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error: msg }, { status: 500, headers: cors });
  }
});
