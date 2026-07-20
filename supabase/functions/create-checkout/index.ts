/**
 * create-checkout — starts a Stripe Checkout session for Declutter Pro.
 *
 * Auth: verify_jwt is on (default), so only signed-in app users can call this.
 * Input: { cycle: 'monthly' | 'yearly', householdId: string }
 * Output: { ok: true, url } — the Stripe-hosted checkout page to redirect to.
 *
 * Configuration: requires STRIPE_SECRET_KEY in Supabase edge-function secrets.
 * Until it is set, this returns 503 { ok: false, error: 'payments_not_configured' }
 * and the client shows a friendly "payments are almost ready" note. The key is
 * NEVER in the repo — `supabase secrets set STRIPE_SECRET_KEY=...` only.
 *
 * Catalog: product + prices are found-or-created by lookup key
 * (declutter_pro_monthly / declutter_pro_yearly), so a fresh Stripe account
 * needs zero dashboard setup — the first checkout call provisions the catalog
 * idempotently. Placeholder pricing: $4.99/mo, $49.99/yr (usd).
 */

import Stripe from 'npm:stripe@17';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PRICES = {
  monthly: { lookupKey: 'declutter_pro_monthly', unitAmount: 499, interval: 'month' as const },
  yearly: { lookupKey: 'declutter_pro_yearly', unitAmount: 4999, interval: 'year' as const },
};

const PRODUCT_NAME = 'Declutter Pro';
const SUCCESS_URL = 'https://inventoryourhouse.com/settings?session_id={CHECKOUT_SESSION_ID}';
const CANCEL_URL = 'https://inventoryourhouse.com/upgrade';

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

    const { cycle, householdId } = await req.json();
    if (cycle !== 'monthly' && cycle !== 'yearly') {
      return Response.json(
        { ok: false, error: "cycle must be 'monthly' or 'yearly'." },
        { status: 400, headers: cors }
      );
    }
    if (!householdId || typeof householdId !== 'string') {
      return Response.json(
        { ok: false, error: 'householdId is required.' },
        { status: 400, headers: cors }
      );
    }

    // Caller identity (the JWT was already verified by the platform; this
    // resolves it to a user so we can attach their email to the customer).
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } }
    );
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    const user = userData?.user;
    if (userErr || !user?.email) {
      return Response.json(
        { ok: false, error: 'Could not identify the signed-in user.' },
        { status: 401, headers: cors }
      );
    }

    // Membership check via RLS: household_plans is member-SELECT-only, so a
    // visible row proves the caller belongs to the household they're upgrading.
    const { data: planRow } = await userClient
      .from('household_plans')
      .select('household_id')
      .eq('household_id', householdId)
      .maybeSingle();
    if (!planRow) {
      return Response.json(
        { ok: false, error: 'You are not a member of that household.' },
        { status: 403, headers: cors }
      );
    }

    const stripe = new Stripe(key, { httpClient: Stripe.createFetchHttpClient() });
    const spec = PRICES[cycle as keyof typeof PRICES];

    // Find-or-create the price by lookup key (idempotent catalog bootstrap).
    let price = (
      await stripe.prices.list({ lookup_keys: [spec.lookupKey], active: true, limit: 1 })
    ).data[0];
    if (!price) {
      // Reuse the product if the other cycle already created it.
      const products = await stripe.products.list({ active: true, limit: 100 });
      const product =
        products.data.find((p) => p.name === PRODUCT_NAME) ??
        (await stripe.products.create({ name: PRODUCT_NAME }));
      price = await stripe.prices.create({
        product: product.id,
        currency: 'usd',
        unit_amount: spec.unitAmount,
        recurring: { interval: spec.interval },
        lookup_key: spec.lookupKey,
      });
    }

    // Find-or-create the Stripe customer by the caller's email.
    const email = user.email.trim().toLowerCase();
    const customer =
      (await stripe.customers.list({ email, limit: 1 })).data[0] ??
      (await stripe.customers.create({ email }));

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customer.id,
      line_items: [{ price: price.id, quantity: 1 }],
      metadata: { household_id: householdId },
      subscription_data: { metadata: { household_id: householdId } },
      success_url: SUCCESS_URL,
      cancel_url: CANCEL_URL,
      allow_promotion_codes: true,
    });

    if (!session.url) {
      return Response.json(
        { ok: false, error: 'Stripe did not return a checkout URL.' },
        { status: 502, headers: cors }
      );
    }

    return Response.json({ ok: true, url: session.url }, { headers: cors });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error: msg }, { status: 500, headers: cors });
  }
});
