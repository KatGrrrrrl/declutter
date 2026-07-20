/**
 * Billing — the client side of Stripe Checkout for Declutter Pro (web).
 *
 * Flow: Upgrade screen → startCheckout() → redirect to the Stripe-hosted page
 * → Stripe returns to /settings?session_id=… → verifyCheckout() confirms the
 * payment server-side and household_plans flips to 'pro' → refreshPlan() keeps
 * the local entitlement honest on later visits.
 *
 * Preconditions surfaced as reasons, not failures: checkout needs a signed-in
 * account (the subscription follows it) and a backed-up household (Pro is a
 * property of the cloud household row). Until STRIPE_SECRET_KEY is set in
 * Supabase secrets, the functions answer 'payments_not_configured' and the UI
 * says so warmly instead of pretending.
 *
 * Native is untouched here — App Store / Play purchases arrive with the store
 * release; this module is only invoked from the web paywall.
 */

import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';

export type BillingCycle = 'monthly' | 'yearly';

export type StartCheckoutResult =
  | { ok: true; url: string }
  | {
      ok: false;
      reason: 'needs_account' | 'needs_backup' | 'payments_not_configured' | 'error';
      error?: string;
    };

export interface VerifyCheckoutResult {
  ok: boolean;
  plan?: 'free' | 'pro';
  status?: string;
  error?: string;
}

/**
 * Invoke an edge function and always surface its JSON body — supabase-js
 * treats non-2xx as an error and hides the payload behind error.context, but
 * our functions put the useful signal (e.g. 'payments_not_configured', 503)
 * in that body.
 */
async function invokeBilling(
  name: string,
  body: Record<string, unknown>
): Promise<{ ok?: boolean; [k: string]: unknown } | null> {
  try {
    const { data, error } = await supabase.functions.invoke(name, { body });
    if (error) {
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === 'function') {
        try {
          return await ctx.json();
        } catch {
          // fall through to the generic message
        }
      }
      return { ok: false, error: error.message };
    }
    return data ?? null;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Start a Stripe Checkout for the current cloud household. On success, send
 * the browser to the returned URL (web only).
 */
export async function startCheckout(cycle: BillingCycle): Promise<StartCheckoutResult> {
  const { data: auth } = await supabase.auth.getSession();
  if (!auth.session) return { ok: false, reason: 'needs_account' };

  const householdId = useStore.getState().cloudHouseholdId;
  if (!householdId) return { ok: false, reason: 'needs_backup' };

  const res = await invokeBilling('create-checkout', { cycle, householdId });
  if (res?.ok && typeof res.url === 'string') return { ok: true, url: res.url };
  if (res?.error === 'payments_not_configured') {
    return { ok: false, reason: 'payments_not_configured' };
  }
  return {
    ok: false,
    reason: 'error',
    error: typeof res?.error === 'string' ? res.error : undefined,
  };
}

/**
 * Confirm a finished checkout (session_id from the success-URL query string).
 * The server retrieves the session from Stripe and, if paid, writes the 'pro'
 * row — so entitlement flips even before any webhook is configured.
 */
export async function verifyCheckout(sessionId: string): Promise<VerifyCheckoutResult> {
  const res = await invokeBilling('verify-checkout', { sessionId });
  if (!res) return { ok: false, error: 'No response from the server.' };
  if (res.ok && res.plan === 'pro') {
    useStore.getState().setPlan('pro');
  }
  return res as unknown as VerifyCheckoutResult;
}

/**
 * Pull the household's plan from the cloud and mirror it locally. Quietly does
 * nothing when signed out or not yet backed up — local state stands alone then.
 */
export async function refreshPlan(): Promise<void> {
  const { data: auth } = await supabase.auth.getSession();
  if (!auth.session) return;

  const householdId = useStore.getState().cloudHouseholdId;
  if (!householdId) return;

  const { data } = await supabase
    .from('household_plans')
    .select('plan')
    .eq('household_id', householdId)
    .maybeSingle();

  if (data?.plan === 'pro' || data?.plan === 'free') {
    useStore.getState().setPlan(data.plan);
  }
}
