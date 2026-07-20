/**
 * Email notification preferences — client side.
 *
 * Each member of a cloud-linked household chooses, per household:
 *   off      — no email (the default)
 *   instant  — an email whenever family adds an item (notify-item-added Edge Fn)
 *   daily    — one evening digest (daily-digest Edge Fn, invoked on a schedule)
 *
 * Preferences live in public.notification_prefs (one row per user+household,
 * self-service under RLS). Everything here degrades gracefully: no session or
 * no cloud household means "unavailable", never an error — email is an
 * enhancement layered on top of the local-first app, not a dependency.
 */

import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';

import type { Item } from '@/lib/store';

export type NotifyMode = 'off' | 'instant' | 'daily';

/**
 * The caller's preference for the active cloud household, or null when it
 * cannot exist yet (signed out, or the household isn't backed up to the
 * cloud). "No row yet" reads as 'off' — that IS the default.
 */
export async function getNotifyPref(): Promise<NotifyMode | null> {
  const householdId = useStore.getState().cloudHouseholdId;
  if (!householdId) return null;
  const { data: auth } = await supabase.auth.getSession();
  if (!auth.session) return null;

  const { data, error } = await supabase
    .from('notification_prefs')
    .select('mode')
    .eq('user_id', auth.session.user.id)
    .eq('household_id', householdId)
    .maybeSingle();
  if (error) return null; // offline / transient — treat as unavailable
  return (data?.mode as NotifyMode | undefined) ?? 'off';
}

/**
 * Upsert the caller's own preference row for the active cloud household,
 * stamping the delivery email from the auth session.
 */
export async function setNotifyPref(mode: NotifyMode): Promise<{ ok: boolean; error?: string }> {
  const householdId = useStore.getState().cloudHouseholdId;
  if (!householdId) return { ok: false, error: 'This household is not backed up yet.' };
  const { data: auth } = await supabase.auth.getSession();
  if (!auth.session) return { ok: false, error: 'Not signed in.' };
  const email = auth.session.user.email;
  if (!email) return { ok: false, error: 'Your account has no email address.' };

  const { error } = await supabase.from('notification_prefs').upsert(
    {
      user_id: auth.session.user.id,
      household_id: householdId,
      mode,
      email,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,household_id' }
  );
  return error ? { ok: false, error: error.message } : { ok: true };
}

/**
 * Fire-and-forget "family just added an item" ping — the server fans out to
 * everyone in the household who chose instant emails (never the adder).
 * Silent no-op when signed out, not cloud-linked, or the item is localOnly
 * (localOnly's contract is "never leaves the device" — that includes emails).
 */
export function pingItemAdded(item: Item): void {
  const householdId = useStore.getState().cloudHouseholdId;
  if (!householdId || item.localOnly) return;
  void supabase.auth
    .getSession()
    .then(({ data }) => {
      if (!data.session) return;
      return supabase.functions.invoke('notify-item-added', {
        body: {
          itemId: item.id,
          itemTitle: item.title,
          householdId,
          addedBy: item.addedBy,
        },
      });
    })
    .catch(() => {}); // notification failure must never surface in capture flow
}
