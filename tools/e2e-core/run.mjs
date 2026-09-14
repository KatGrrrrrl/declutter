#!/usr/bin/env node
/**
 * e2e-core — the rebuilt identity/sync core, end to end, against production.
 *
 *   PGPASSWORD=… node tools/e2e-core/run.mjs
 *
 * Bundles the app's real src/lib into a Node "device" (tools/e2e-core/device.ts)
 * and runs it as two devices — the owner's and a helper's — each with its own
 * persisted storage, through: create a home, capture, decide, invite, join,
 * a helper's refused decision, a delete that must not resurrect, and an
 * offline capture on a device that changes hands before it reconnects.
 *
 * Accounts are minted with psql (database password — not the service-role
 * key) and removed in `finally`, with their household. No email is sent: the
 * helper already has an account when invited, which Supabase Auth never
 * re-emails.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
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
const owner = { id: randomUUID(), email: `core-owner-${run}@example.com` };
const helper = { id: randomUUID(), email: `core-helper-${run}@example.com` };
const work = mkdtempSync(join(tmpdir(), `e2e-core-${run}-`));
const bundle = join(work, 'device.bundle.cjs');
let householdId = null;
let failures = 0;

function mint({ id, email }) {
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

function device(stateFile, scenario, params = {}) {
  console.log(`\n── ${scenario} (${stateFile})`);
  const res = spawnSync(process.execPath, [bundle, scenario], {
    cwd: work,
    encoding: 'utf8',
    env: {
      ...process.env,
      DEVICE_STATE: join(work, stateFile),
      OWNER_EMAIL: owner.email,
      HELPER_EMAIL: helper.email,
      PASSWORD: password,
      PARAMS: JSON.stringify(params),
    },
    timeout: 180000,
  });
  const out = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  for (const line of out.split('\n')) if (line.startsWith('CHECK') || line.startsWith('(timed out')) console.log('  ' + line);
  const m = out.match(/^RESULT (.*)$/m);
  const parsed = m ? JSON.parse(m[1]) : { failures: 1 };
  if (!m) console.log(out.slice(-3000));
  failures += parsed.failures ?? 0;
  return parsed;
}

const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`  CHECK ${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
};

try {
  // Bundle the real core for Node.
  execFileSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    [
      '-y', 'esbuild', join(here, 'device.ts'),
      '--bundle', '--platform=node', '--format=cjs', `--outfile=${bundle}`,
      `--tsconfig=${join(root, 'tsconfig.json')}`,
      `--alias:react-native=${join(here, 'shims/react-native.mjs')}`,
      `--alias:@react-native-async-storage/async-storage=${join(here, 'shims/async-storage.mjs')}`,
      '--external:expo-*',
      '--log-level=warning',
    ],
    { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' }
  );

  mint(owner);
  mint(helper);

  const a1 = device('owner.json', 'owner-create', { homeName: `Core check ${run}` });
  householdId = a1.householdId;
  if (!householdId) throw new Error('no household created');

  device('helper.json', 'helper-join', { householdId });
  device('owner.json', 'owner-delete', { householdId });
  device('helper.json', 'helper-refresh', { householdId });
  device('helper.json', 'helper-offline-switch', { householdId });

  console.log('\n── database, afterwards');
  const vase = sql(`select coalesce(created_by::text,'') from public.items where household_id=${lit(householdId)} and title='Offline vase';`);
  check('the offline capture exists in the cloud, attributed to the helper', vase === helper.id, vase || '(missing)');
  const clock = sql(`select count(*) from public.items where household_id=${lit(householdId)} and title='Clock';`);
  check('the deleted clock stayed deleted', clock === '0', clock);
  const lamp = sql(`select decision from public.items where household_id=${lit(householdId)} and title='Lamp';`);
  check('the helper could not decide the lamp', lamp === 'undecided', lamp);
  const album = sql(`select coalesce(created_by::text,'') from public.items where household_id=${lit(householdId)} and title='Album (1970s)';`);
  check('the helper’s edit to their own capture landed', album === helper.id, album || '(missing)');
} catch (e) {
  failures++;
  console.log(`CHECK FAIL harness — ${e instanceof Error ? e.message : String(e)}`);
} finally {
  try {
    if (householdId) sql(`delete from public.households where id=${lit(householdId)};`);
    sql(`delete from public.households where created_by in (${lit(owner.id)}, ${lit(helper.id)});
         delete from auth.users where id in (${lit(owner.id)}, ${lit(helper.id)});`);
    const left = sql(`select (select count(*) from auth.users where email like 'core-%-${run}@example.com')
                        + (select count(*) from public.households where name = 'Core check ${run}');`);
    console.log(left === '0' ? '\nCLEAN nothing left behind' : `\nWARN ${left} test rows remain`);
  } catch (e) {
    console.log(`WARN cleanup failed — ${e instanceof Error ? e.message : String(e)}`);
  }
  rmSync(work, { recursive: true, force: true });
}

console.log(`--- ${failures === 0 ? 'all checks passed' : `${failures} failing`}`);
process.exit(failures ? 1 : 0);
