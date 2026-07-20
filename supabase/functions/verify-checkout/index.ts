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
 * cancellations). Session ids are unguessable, and the household written is
 * whatever the session's own metadata says — a caller can only ever confirm a
 * genuine payment onto the household that payment was for.
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

    const stripe = new Stripe(key, { httpClient: Stripe.createFetchHttpClient() });
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['subscription'],
    });

    const subscription =
      session.subscription && typeof session.subscription !== 'string'
        ? session.subscription
        : null;

    const paid =
      session.payment_status === 'paid' ||
      (subscription !== null && ['active', 'trialing'].includes(subscription.status));

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

    // Only the service role may write household_plans (no client policies).
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
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
