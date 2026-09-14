/**
 * verify-checkout — confirms a completed Stripe Checkout session and flips the
 * household's plan to 'pro'.
 *
 * Auth: verify_jwt is on (default), so only signed-in app users can call this.
 * Input: { sessionId: string } — the {CHECKOUT_SESSION_ID} Stripe appended to
 * the success URL (Settings reads it from the query string on mount).
 * Output: { ok: true, plan: 'pro' } after upserting household_plans, or
 * { ok: true, plan: 'free', status } if the session wasn't actually paid.
 *
 * This is the pull-side of entitlement: it makes payments work end-to-end with
 * NO webhook configured (the webhook is later hardening for renewals and
 * cancellations). The household written is whatever the session's own
 * metadata says, and three checks stand in front of that write:
 *
 *  1. The caller is the person who started this checkout (create-checkout
 *     stamps client_reference_id = user.id). A session id is unguessable but
 *     not secret — it rides in the success URL, so it lands in browser
 *     history and screenshots.
 *  2. The caller is still an active member of that household. Deliberately
 *     not owner-only: an adult child paying for their parents' Pro is the
 *     expected case, and paying grants no authority over anything.
 *  3. For a subscription, the subscription is active or trialing NOW.
 *     `payment_status === 'paid'` stays true for a session forever, so the
 *     old rule let anyone who had ever paid re-send their success link after
 *     cancelling and switch Pro straight back on.
 *
 * Configuration: requires STRIPE_SECRET_KEY in Supabase edge-function secrets;
 * absent → 503 { ok: false, error: 'payments_not_configured' }.
 */

import Stripe from 'npm:stripe@17';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const key = Deno.env.get('STRIPE_SECRET_KEY');
    if (!key) {
      return Response.json(
        { ok: false, error: 'payments_not_configured' },
        { status: 503, headers: cors }
      );
    }

    const { sessionId } = await req.json();
    if (!sessionId || typeof sessionId !== 'string') {
      return Response.json(
        { ok: false, error: 'sessionId is required.' },
        { status: 400, headers: cors }
      );
    }

    // Who is confirming? (verify_jwt only proves a project-signed token, and
    // the public anon key is one.)
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: userData } = await admin.auth.getUser(token);
    const userId = userData?.user?.id;
    if (!userId) {
      return Response.json({ ok: false, error: 'Not signed in.' }, { status: 401, headers: cors });
    }

    const stripe = new Stripe(key, { httpClient: Stripe.createFetchHttpClient() });
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['subscription'],
    });

    // (1) Only the person who started this checkout may confirm it. Sessions
    // created before create-checkout stamped a buyer carry none, and are
    // refused rather than trusted.
    if (!session.client_reference_id || session.client_reference_id !== userId) {
      return Response.json(
        { ok: false, error: 'This checkout was started by a different account.' },
        { status: 403, headers: cors }
      );
    }

    const subscription =
      session.subscription && typeof session.subscription !== 'string'
        ? session.subscription
        : null;

    // (3) A subscription is judged by its state now, never by the fact that
    // its first invoice was once paid.
    const paid =
      session.mode === 'subscription'
        ? subscription !== null && ['active', 'trialing'].includes(subscription.status)
        : session.payment_status === 'paid';

    if (!paid) {
      return Response.json(
        { ok: true, plan: 'free', status: session.payment_status },
        { headers: cors }
      );
    }

    const householdId = session.metadata?.household_id;
    if (!householdId) {
      return Response.json(
        { ok: false, error: 'Checkout session has no household attached.' },
        { status: 400, headers: cors }
      );
    }

    // (2) Still a member of the household this payment is for.
    const { data: membership } = await admin
      .from('household_members')
      .select('id')
      .eq('household_id', householdId)
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle();
    if (!membership) {
      return Response.json(
        { ok: false, error: 'You are no longer a member of that household.' },
        { status: 403, headers: cors }
      );
    }

    // Only the service role may write household_plans (no client policies).
    const { error } = await admin.from('household_plans').upsert({
      household_id: householdId,
      plan: 'pro',
      stripe_customer_id: typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null,
      stripe_subscription_id: subscription?.id ?? null,
      current_period_end: subscription?.current_period_end
        ? new Date(subscription.current_period_end * 1000).toISOString()
        : null,
    });
    if (error) {
      return Response.json({ ok: false, error: error.message }, { status: 500, headers: cors });
    }

    return Response.json({ ok: true, plan: 'pro' }, { headers: cors });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error: msg }, { status: 500, headers: cors });
  }
});
