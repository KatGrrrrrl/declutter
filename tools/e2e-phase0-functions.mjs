#!/usr/bin/env node
/**
 * e2e-phase0-functions — proves the phase-0 edge-function authorization from
 * the outside, with real sign-ins, then removes every trace.
 *
 *   PGPASSWORD=… node tools/e2e-phase0-functions.mjs
 *
 * Needs `psql` (PostgreSQL client) and the database password — NOT the
 * service-role key. Throwaway accounts are minted directly in auth.users with
 * a random password, signed in through the public API like any user, and
 * deleted at the end (a `finally`, so a failed assertion still cleans up).
 *
 * Deliberately sends no email to anyone: the invitation success path invites
 * an address that already has an account, which Supabase Auth never re-emails.
 * Checkout creates one TEST-mode Stripe session that is never paid.
 */

import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';

const URL = 'https://auth.inventoryourhouse.com';
const ANON = 'sb_publishable_jvgjfZky19YKaFVrH29OWw_6srBfiP1'; // public by design (src/lib/supabase.ts)
const PSQL = process.env.PSQL ?? 'C:/Program Files/PostgreSQL/18/bin/psql.exe';
const CONN =
  process.env.PG_CONN ??
  'host=aws-0-ca-central-1.pooler.supabase.com port=5432 dbname=postgres user=postgres.xkzuoogmcfrxicmoybzp sslmode=require';

if (!process.env.PGPASSWORD) {
  console.error('Set PGPASSWORD (the database password, e.g. from .dbpassword.local).');
  process.exit(2);
}

const sql = (q) => execFileSync(PSQL, [CONN, '-v', 'ON_ERROR_STOP=1', '-tA', '-c', q], { encoding: 'utf8' }).trim();
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

const run = randomBytes(3).toString('hex');
const password = randomBytes(18).toString('base64url');
const people = {
  owner: { id: randomUUID(), email: `fnchk-owner-${run}@example.com` },
  admin: { id: randomUUID(), email: `fnchk-admin-${run}@example.com` },
  outsider: { id: randomUUID(), email: `fnchk-outsider-${run}@example.com` },
};
const householdId = randomUUID();
const itemId = randomUUID();

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
};

function mintUser({ id, email }) {
  sql(`
    insert into auth.users (id, instance_id, email, encrypted_password, aud, role, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, recovery_token, email_change_token_new, email_change)
    values (${lit(id)}, '00000000-0000-0000-0000-000000000000', ${lit(email)},
            extensions.crypt(${lit(password)}, extensions.gen_salt('bf')), 'authenticated', 'authenticated', now(),
            '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (${lit(id)}, ${lit(id)}, jsonb_build_object('sub', ${lit(id)}, 'email', ${lit(email)}, 'email_verified', true),
            'email', now(), now(), now());`);
}

async function signIn({ email }) {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`sign-in failed for ${email}: ${JSON.stringify(j)}`);
  return j.access_token;
}

async function call(fn, token, body) {
  const r = await fetch(`${URL}/functions/v1/${fn}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let j = null;
  try { j = await r.json(); } catch { /* non-JSON */ }
  return { status: r.status, body: j };
}

try {
  // ---- fixtures: a home owned by `owner`, where `admin` is an administrator
  // with no final say; `outsider` belongs to nothing.
  for (const p of Object.values(people)) mintUser(p);
  sql(`insert into public.households (id, name, created_by) values (${lit(householdId)}, 'Function check ${run}', ${lit(people.owner.id)});`);
  sql(`insert into public.household_members (household_id, user_id, role, status, invited_by, accepted_at, is_admin, invited_email)
       values (${lit(householdId)}, ${lit(people.admin.id)}, 'contributor', 'active', ${lit(people.owner.id)}, now(), true, ${lit(people.admin.email)});`);
  sql(`insert into public.items (id, household_id, created_by, title, room) values (${lit(itemId)}, ${lit(householdId)}, ${lit(people.owner.id)}, 'Brass lamp', 'Den');
       insert into public.item_tags (item_id, tag) values (${lit(itemId)}, 'brass');`);

  const owner = await signIn(people.owner);
  const admin = await signIn(people.admin);
  const outsider = await signIn(people.outsider);

  // ---- notify-item-added
  let r = await call('notify-item-added', ANON, { householdId, itemTitle: 'Spoof', addedBy: 'Mum' });
  check('notify-item-added refuses the public key', r.status === 401 || r.status === 403, `${r.status}`);
  r = await call('notify-item-added', outsider, { householdId, itemId, itemTitle: 'Spoof' });
  check('notify-item-added refuses a non-member', r.status === 403, `${r.status} ${r.body?.error ?? ''}`);
  r = await call('notify-item-added', owner, { householdId, itemId, itemTitle: 'Brass lamp', addedBy: 'Owner' });
  check('notify-item-added works for a member', r.status === 200 && r.body?.ok === true, `${r.status} ${JSON.stringify(r.body)}`);

  // ---- estimate-value (free plan): must reach the Pro gate, not die on the query
  r = await call('estimate-value', owner, { itemId });
  check('estimate-value reads the item and reaches the Pro gate', r.status === 402, `${r.status} ${JSON.stringify(r.body)}`);
  r = await call('estimate-value', outsider, { itemId });
  check('estimate-value hides another home\'s item', r.status === 404, `${r.status}`);

  // ---- invite-member
  r = await call('invite-member', outsider, { householdId, email: `nobody-${run}@example.com` });
  check('invite-member refuses a non-member', r.status === 403, `${r.status} ${r.body?.error ?? ''}`);
  r = await call('invite-member', admin, { householdId, email: people.outsider.email, role: 'co_owner' });
  check('invite-member: an administrator cannot grant the final say', r.status === 403 && r.body?.reason === 'owner_only_role', `${r.status} ${r.body?.error ?? ''}`);
  r = await call('invite-member', admin, { householdId, email: people.outsider.email, role: 'contributor', name: 'Outsider', relationship: 'Cousin' });
  check('invite-member: an administrator can invite a helper (no email: account exists)', r.status === 200 && r.body?.ok === true, `${r.status} ${JSON.stringify(r.body)}`);
  const row = sql(`select role||'|'||status||'|'||coalesce(display_name,'')||'|'||coalesce(relationship,'') from public.household_members where household_id=${lit(householdId)} and invited_email=${lit(people.outsider.email)};`);
  check('invite-member created the invitation row itself', row === 'contributor|invited|Outsider|Cousin', row || '(no row)');

  // ---- checkout
  r = await call('create-checkout', outsider, { cycle: 'monthly', householdId });
  check('create-checkout refuses a non-member', r.status === 403, `${r.status}`);
  r = await call('create-checkout', owner, { cycle: 'monthly', householdId });
  if (r.status === 503) {
    console.log('SKIP checkout round-trip — payments not configured');
  } else {
    const sessionId = typeof r.body?.url === 'string' ? (r.body.url.match(/(cs_[A-Za-z0-9_]+)/) ?? [])[1] : undefined;
    check('create-checkout returns a checkout for a member', r.status === 200 && Boolean(sessionId), `${r.status} ${r.body?.error ?? ''}`);
    if (sessionId) {
      r = await call('verify-checkout', admin, { sessionId });
      check('verify-checkout refuses someone who did not start the checkout', r.status === 403, `${r.status} ${r.body?.error ?? ''}`);
      r = await call('verify-checkout', owner, { sessionId });
      check('verify-checkout: an unpaid checkout stays free', r.status === 200 && r.body?.plan === 'free', `${r.status} ${JSON.stringify(r.body)}`);
    }
  }
} catch (e) {
  failures++;
  console.log(`FAIL harness — ${e instanceof Error ? e.message : String(e)}`);
} finally {
  try {
    sql(`delete from public.households where id = ${lit(householdId)};
         delete from auth.users where id in (${Object.values(people).map((p) => lit(p.id)).join(',')});`);
    const left = sql(`select (select count(*) from auth.users where email like 'fnchk-%-${run}@example.com')
                        + (select count(*) from public.households where id = ${lit(householdId)});`);
    console.log(left === '0' ? 'CLEAN nothing left behind' : `WARN ${left} test rows remain`);
  } catch (e) {
    console.log(`WARN cleanup failed — ${e instanceof Error ? e.message : String(e)}`);
  }
}

console.log(`--- ${failures === 0 ? 'all checks passed' : `${failures} failing`}`);
process.exit(failures ? 1 : 0);
