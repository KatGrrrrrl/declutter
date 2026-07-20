/**
 * stripe-webhook — keeps household_plans in step with Stripe over time.
 *
 * Deploy with --no-verify-jwt: Stripe calls this directly and cannot send a
 * Supabase JWT. Authenticity comes from the Stripe signature instead — every
 * event is verified against STRIPE_WEBHOOK_SECRET before anything is written.
 *
 * verify-checkout already makes first purchases work without this function;
 * the webhook is the hardening layer that catches what pull-verification
 * can't: renewals extending current_period_end, failed payments, and
 * cancellations dropping the household back to 'free'.
 *
 * Handled events:
 *   - checkout.session.completed          → plan 'pro' (belt-and-braces with
 *                                           verify-checkout; upsert is idempotent)
 *   - customer.subscription.updated       → 'pro' while active/trialing,
 *                                           'free' when canceled/unpaid/expired
 *   - customer.subscription.deleted       → 'free'
 *
 * Configuration: requires STRIPE_WEBHOOK_SECRET (from the Stripe dashboard's
 * webhook endpoint) and STRIPE_SECRET_KEY in Supabase secrets; absent → 503.
 * No key values live in the repo, ever.
 */

import Stripe from 'npm:stripe@17';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cryptoProvider = Stripe.createSubtleCryptoProvider();

function admin() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );
}

/** Statuses that mean the household keeps (or gains) Pro. */
const PRO_STATUSES = ['active', 'trialing'];

Deno.serve(async (req) => {
  const key = Deno.env.get('STRIPE_SECRET_KEY');
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!key || !webhookSecret) {
    return Response.json({ ok: false, error: 'payments_not_configured' }, { status: 503 });
  }

  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    return Response.json({ ok: false, error: 'Missing stripe-signature header.' }, { status: 400 });
  }

  const stripe = new Stripe(key, { httpClient: Stripe.createFetchHttpClient() });

  let event: Stripe.Event;
  try {
    const body = await req.text();
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      webhookSecret,
      undefined,
      cryptoProvider
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error: `Signature verification failed: ${msg}` }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const householdId = session.metadata?.household_id;
        if (householdId && session.payment_status === 'paid') {
          const subscriptionId =
            typeof session.subscription === 'string'
              ? session.subscription
              : session.subscription?.id ?? null;
          const subscription = subscriptionId
            ? await stripe.subscriptions.retrieve(subscriptionId)
            : null;
          const { error } = await admin().from('household_plans').upsert({
            household_id: householdId,
            plan: 'pro',
            stripe_customer_id:
              typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null,
            stripe_subscription_id: subscriptionId,
            current_period_end: subscription?.current_period_end
              ? new Date(subscription.current_period_end * 1000).toISOString()
              : null,
          });
          if (error) throw new Error(error.message);
        }
        break;
      }

      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const householdId = subscription.metadata?.household_id;
        if (householdId) {
          const pro =
            event.type !== 'customer.subscription.deleted' &&
            PRO_STATUSES.includes(subscription.status);
          const { error } = await admin().from('household_plans').upsert({
            household_id: householdId,
            plan: pro ? 'pro' : 'free',
            stripe_customer_id:
              typeof subscription.customer === 'string'
                ? subscription.customer
                : subscription.customer?.id ?? null,
            stripe_subscription_id: pro ? subscription.id : null,
            current_period_end:
              pro && subscription.current_period_end
                ? new Date(subscription.current_period_end * 1000).toISOString()
                : null,
          });
          if (error) throw new Error(error.message);
        }
        break;
      }

      default:
        // Unhandled event types are acknowledged so Stripe stops retrying them.
        break;
    }

    return Response.json({ received: true });
  } catch (e) {
    // Non-2xx makes Stripe retry with backoff — right for transient DB issues.
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
});
