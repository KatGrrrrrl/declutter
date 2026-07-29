/**
 * Flip a household to Pro for testing, without going through Stripe.
 *
 * `household_plans` is service-role-only by design (the Stripe flow is the
 * only writer in production), so this script needs the service role key:
 *
 *   SERVICE_KEY=<service role key> node tools/make-household-pro.mjs [name]
 *
 * Defaults to the household named "test". Prints the membership roster first
 * so you can confirm it's the right household — and see which role you hold,
 * since AI valuation is decider-only while photo-splitting is open to helpers.
 *
 * Reversible: pass --free to put it back on the free plan.
 */

import { createClient } from '@supabase/supabase-js';

const URL = 'https://xkzuoogmcfrxicmoybzp.supabase.co';
const SERVICE = process.env.SERVICE_KEY;

if (!SERVICE) {
  console.error(
    'Missing SERVICE_KEY.\n' +
      'Supabase dashboard → Project settings → API keys → service_role, then:\n' +
      '  SERVICE_KEY=<key> node tools/make-household-pro.mjs'
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const toFree = args.includes('--free');
const name = args.find((a) => !a.startsWith('--')) ?? 'test';
const plan = toFree ? 'free' : 'pro';

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

/* ---- find the household ---- */
const { data: houses, error: hErr } = await admin
  .from('households')
  .select('id, name, created_at')
  .ilike('name', name)
  .order('created_at', { ascending: false });

if (hErr) {
  console.error('Could not read households:', hErr.message);
  process.exit(1);
}
if (!houses?.length) {
  console.error(
    `No cloud household named "${name}".\n` +
      'Create it in the app first (onboarding), and make sure you sign in at the\n' +
      'last step — that is what links the household to the cloud.'
  );
  process.exit(1);
}
if (houses.length > 1) {
  console.log(`${houses.length} households named "${name}" — using the newest:`);
  houses.forEach((h, i) => console.log(`  ${i === 0 ? '→' : ' '} ${h.id}  ${h.created_at}`));
}

const house = houses[0];

/* ---- show who is in it (so you can confirm your role) ---- */
const { data: members } = await admin
  .from('household_members')
  .select('user_id, role, status, invited_email')
  .eq('household_id', house.id);

console.log(`\nHousehold "${house.name}"  ${house.id}`);
if (members?.length) {
  // Resolve emails so the roster is readable rather than a list of UUIDs.
  const emails = new Map();
  for (const m of members) {
    if (!m.user_id) continue;
    const { data } = await admin.auth.admin.getUserById(m.user_id);
    if (data?.user?.email) emails.set(m.user_id, data.user.email);
  }
  console.log('Members:');
  for (const m of members) {
    const who = emails.get(m.user_id) ?? m.invited_email ?? '(unclaimed)';
    const note = m.role === 'contributor' ? '  ← helper: photo-split yes, valuation no' : '';
    console.log(`  ${m.role.padEnd(12)} ${m.status.padEnd(8)} ${who}${note}`);
  }
} else {
  console.log('Members: none (unexpected — the creator should be auto-enrolled)');
}

/* ---- flip the plan ---- */
const { error: pErr } = await admin
  .from('household_plans')
  .upsert({ household_id: house.id, plan }, { onConflict: 'household_id' });

if (pErr) {
  console.error('\nCould not set the plan:', pErr.message);
  process.exit(1);
}

const { data: check } = await admin
  .from('household_plans')
  .select('plan')
  .eq('household_id', house.id)
  .maybeSingle();

console.log(`\nPlan is now: ${check?.plan ?? plan}`);
console.log(
  toFree
    ? 'Back on free — the AI features will ask you to upgrade again.'
    : 'AI features unlocked for this household (needs ANTHROPIC_API_KEY set too).'
);
