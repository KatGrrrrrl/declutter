/**
 * Live test: instant-email notification + Stripe checkout provisioning.
 * Creates two throwaway users and a household; the subscriber prefs point at
 * TEST_EMAIL (Resend sandbox only delivers to the Resend account's own
 * address); the other user adds an item and calls notify-item-added; then
 * create-checkout is exercised. Cleans up after itself.
 *
 *   SERVICE_KEY=... TEST_EMAIL=you@example.com node tools/e2e-email-stripe.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

const URL = 'https://xkzuoogmcfrxicmoybzp.supabase.co';
const PUBLISHABLE = 'sb_publishable_jvgjfZky19YKaFVrH29OWw_6srBfiP1';
const SERVICE = process.env.SERVICE_KEY;
const TEST_EMAIL = process.env.TEST_EMAIL;
if (!SERVICE || !TEST_EMAIL) { console.error('SERVICE_KEY and TEST_EMAIL required'); process.exit(1); }

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
const anon = () => createClient(URL, PUBLISHABLE, { auth: { persistSession: false } });
const stamp = Date.now();
const pw = `Test-${randomUUID()}`;
const log = (n, ok, d = '') => console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`);

let aId, bId, hid;
try {
  const a = await admin.auth.admin.createUser({ email: `e2e-adder-${stamp}@example.com`, password: pw, email_confirm: true });
  const b = await admin.auth.admin.createUser({ email: `e2e-reader-${stamp}@example.com`, password: pw, email_confirm: true });
  aId = a.data.user?.id; bId = b.data.user?.id;

  const adder = anon();
  await adder.auth.signInWithPassword({ email: `e2e-adder-${stamp}@example.com`, password: pw });
  hid = randomUUID();
  await adder.from('households').insert({ id: hid, name: 'Email Test House' });
  await adder.from('household_members').insert({ household_id: hid, invited_email: `e2e-reader-${stamp}@example.com`, role: 'contributor', status: 'invited' });

  const reader = anon();
  await reader.auth.signInWithPassword({ email: `e2e-reader-${stamp}@example.com`, password: pw });
  await reader.rpc('accept_invite', { p_household_id: hid });
  // Subscriber prefers instant emails, delivered to the real test address.
  const pref = await reader.from('notification_prefs').insert({
    user_id: bId, household_id: hid, mode: 'instant', email: TEST_EMAIL,
  });
  log('subscriber pref saved', !pref.error, pref.error?.message);

  const itemId = randomUUID();
  await adder.from('items').insert({ id: itemId, household_id: hid, created_by: aId, title: 'Email test teapot', decision: 'undecided' });

  const { data: notif, error: nErr } = await adder.functions.invoke('notify-item-added', {
    body: { itemId, itemTitle: 'Email test teapot', householdId: hid, addedBy: 'E2E Adder' },
  });
  log('notify-item-added call', !nErr && notif?.ok, nErr?.message ?? JSON.stringify(notif));

  const { data: co, error: cErr } = await adder.functions.invoke('create-checkout', {
    body: { cycle: 'monthly', householdId: hid },
  });
  const url = co?.url ?? '';
  log('create-checkout returns Stripe URL', !cErr && co?.ok && url.startsWith('https://checkout.stripe.com'),
      cErr?.message ?? (co?.error ?? url.slice(0, 60)));
} catch (e) {
  log('unexpected exception', false, e.message);
} finally {
  if (hid) await admin.from('households').delete().eq('id', hid);
  if (aId) await admin.auth.admin.deleteUser(aId);
  if (bId) await admin.auth.admin.deleteUser(bId);
  console.log('cleanup done');
}
