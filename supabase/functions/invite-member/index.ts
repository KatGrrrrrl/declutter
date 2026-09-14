/**
 * invite-member — creates a household invitation and sends the email.
 *
 * POST { householdId, email, name?, relationship?, role?: 'contributor' | 'co_owner' }
 *
 * Auth: verify_jwt is on, but that only proves a project-signed token (the
 * public anon key is one). The real checks are here:
 *  - the caller resolves to a user who is an ACTIVE member of the household
 *    and is its owner/co_owner OR one of its administrators;
 *  - inviting someone with the final say (co_owner) is the owner's call alone.
 *    An administrator — usually the adult child running things — may bring
 *    people in, but may not hand anyone authority over the parent's decisions.
 *
 * Before this, the function checked nothing: any signed-in account could make
 * Supabase Auth email an invitation to any address, naming any household.
 *
 * The membership row and the email now happen here together. The invitation
 * row used to be inserted by the app, under an owner-only policy, before this
 * function was called — so an administrator who wasn't an owner got the email
 * sent with no invitation behind it, and nothing said so.
 *
 * Delivery: Supabase Auth's admin invite — creates (or reuses) the auth user
 * and emails a sign-in link. An address that already has an account gets no
 * Auth email (Supabase refuses to re-invite a registered user); the
 * invitation still exists and the person sees it the next time they sign in.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const json = (status: number, body: Record<string, unknown>) =>
  Response.json(body, { status, headers: cors });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const body = await req.json().catch(() => ({}));
    const householdId = typeof body.householdId === 'string' ? body.householdId : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 120) : null;
    const relationship =
      typeof body.relationship === 'string' && body.relationship.trim()
        ? body.relationship.trim().slice(0, 80)
        : null;
    const role = body.role === 'co_owner' ? 'co_owner' : 'contributor';

    if (!UUID.test(householdId)) return json(400, { ok: false, error: 'householdId is required.' });
    if (!email.includes('@') || !email.includes('.')) {
      return json(400, { ok: false, error: 'A valid email is required.' });
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // ---- who is asking, and may they?
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: userData } = await admin.auth.getUser(token);
    const caller = userData?.user;
    if (!caller) return json(401, { ok: false, error: 'Not signed in.' });

    const { data: me } = await admin
      .from('household_members')
      .select('role, is_admin')
      .eq('household_id', householdId)
      .eq('user_id', caller.id)
      .eq('status', 'active')
      .maybeSingle();
    const isOwner = me?.role === 'owner' || me?.role === 'co_owner';
    if (!me || !(isOwner || me.is_admin)) {
      return json(403, { ok: false, error: 'Only an owner or administrator of this home can invite people.' });
    }
    if (role === 'co_owner' && !isOwner) {
      return json(403, {
        ok: false,
        error: 'Only an owner can invite someone with the final say.',
        reason: 'owner_only_role',
      });
    }
    if (email === (caller.email ?? '').toLowerCase()) {
      return json(400, { ok: false, error: 'You are already in this home.' });
    }

    const { data: household } = await admin
      .from('households')
      .select('name')
      .eq('id', householdId)
      .maybeSingle();
    if (!household) return json(404, { ok: false, error: 'Household not found.' });

    // ---- the invitation row (idempotent)
    const { data: existing } = await admin
      .from('household_members')
      .select('id, status')
      .eq('household_id', householdId)
      .eq('invited_email', email)
      .in('status', ['invited', 'active']);
    if (existing?.some((m) => m.status === 'active')) {
      return json(200, { ok: true, alreadyMember: true });
    }
    if (!existing?.length) {
      const { error: insertErr } = await admin.from('household_members').insert({
        household_id: householdId,
        invited_email: email,
        role,
        status: 'invited',
        invited_by: caller.id,
        display_name: name,
        relationship,
      });
      if (insertErr) return json(500, { ok: false, error: insertErr.message });
    }

    // ---- the email
    const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: 'https://inventoryourhouse.com',
      data: {
        invited_name: name,
        invited_to_household: household.name,
        invited_by: caller.email ?? null,
      },
    });
    // A registered address can't be re-invited by Auth; the invitation row
    // above is what matters, and they'll find it on their next sign-in.
    const alreadyRegistered = Boolean(inviteErr && /already.*(registered|exists)/i.test(inviteErr.message));
    if (inviteErr && !alreadyRegistered) {
      return json(502, { ok: false, error: inviteErr.message, invitationCreated: true });
    }

    return json(200, { ok: true, alreadyRegistered });
  } catch (e) {
    return json(500, { ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});
