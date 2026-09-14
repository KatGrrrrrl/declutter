/**
 * One "device" running the app's real src/lib (auth, membership, outbox,
 * household, store) under Node. Bundled by tools/e2e-core/run.mjs; each run
 * is a separate process with its own persisted storage (DEVICE_STATE), so a
 * later run on the same device sees what an earlier one left behind — the
 * whole point for testing resurrection and account switching.
 *
 *   node device.bundle.cjs <scenario>
 *   env: DEVICE_STATE, OWNER_EMAIL, HELPER_EMAIL, PASSWORD, PARAMS (JSON)
 *
 * Prints `CHECK PASS|FAIL <label> — detail` lines and one final `RESULT {json}`.
 */

import './shims/network.mjs';

import { awaitAuthReady, currentSession, signOut, startAuth } from '@/lib/auth';
import { acceptInvite, createHousehold, listPendingInvites, openHousehold, pickHousehold } from '@/lib/household';
import { inviteToHousehold, loadMyMemberships, startMembership } from '@/lib/membership';
import { opsSnapshot, startOutbox } from '@/lib/outbox';
import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';

type G = typeof globalThis & { __offline: boolean };

const env = process.env;
const params = JSON.parse(env.PARAMS || '{}') as Record<string, string>;
const result: Record<string, unknown> = {};
let failures = 0;

function check(label: string, ok: boolean, detail = '') {
  if (!ok) failures++;
  console.log(`CHECK ${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(what: string, cond: () => boolean, timeoutMs = 30000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (cond()) return true;
    await sleep(150);
  }
  console.log(`(timed out waiting for: ${what})`);
  return false;
}

async function signIn(email: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: env.PASSWORD! });
  if (error || !data.user) throw new Error(`sign-in failed for ${email}: ${error?.message}`);
  const uid = data.user.id;
  await waitFor(`signed-in as ${email}`, () => {
    const s = currentSession();
    return s.status === 'signed-in' && s.userId === uid;
  });
  await awaitAuthReady();
  await loadMyMemberships();
  return uid;
}

async function drained(uid: string, timeoutMs = 30000) {
  return waitFor('outbox drained', () => !opsSnapshot().some((o) => o.userId === uid && o.status === 'pending'), timeoutMs);
}

const items = () => useStore.getState().items;
const byTitle = (t: string) => items().find((i) => i.title === t);

/* -------------------------------------------------------------------------- scenarios */

const scenarios: Record<string, () => Promise<void>> = {
  /** Owner creates a home, captures two items, decides one, invites the helper. */
  async 'owner-create'() {
    const uid = await signIn(env.OWNER_EMAIL!);
    const created = await createHousehold(params.homeName, { displayName: 'Owner Test' });
    check('owner creates a home in the cloud', created.ok, created.ok ? '' : created.error);
    if (!created.ok) return;
    const hid = created.householdId;
    result.householdId = hid;

    const lamp = useStore.getState().addItem({ title: 'Lamp', room: 'Den', addedBy: 'Owner Test' });
    const clock = useStore.getState().addItem({ title: 'Clock', room: 'Den', addedBy: 'Owner Test' });
    useStore.getState().decide(clock.id!, 'keep');
    result.lampId = lamp.id;
    result.clockId = clock.id;
    check('owner captures and decides; the outbox drains', await drained(uid));
    check('nothing the owner did was refused', !opsSnapshot().some((o) => o.status === 'failed'),
      JSON.stringify(opsSnapshot().filter((o) => o.status === 'failed').map((o) => o.lastError)));

    const inv = await inviteToHousehold({ email: env.HELPER_EMAIL!, name: 'Helper Test', relationship: 'Cousin', role: 'contributor' });
    check('owner invites the helper', inv.ok, inv.ok ? '' : inv.error);
  },

  /** Helper finds the invitation, joins, captures, and is refused a decision — visibly. */
  async 'helper-join'() {
    const uid = await signIn(env.HELPER_EMAIL!);
    result.helperId = uid;
    const picked = await pickHousehold();
    check('before accepting, the helper has no home of their own', Boolean(picked.none), JSON.stringify(picked));
    const invites = await listPendingInvites();
    check('the helper sees the invitation', invites.some((i) => i.householdId === params.householdId));
    const joined = await acceptInvite(params.householdId);
    check('the helper accepts and the home opens', joined.ok, joined.ok ? '' : joined.error);

    check('the helper sees the owner’s items', Boolean(byTitle('Lamp') && byTitle('Clock')), items().map((i) => i.title).join(','));
    check('captures are attributed by the member’s own name', byTitle('Lamp')?.addedBy === 'Owner Test', String(byTitle('Lamp')?.addedBy));
    check('the owner’s decision arrived', byTitle('Clock')?.decision === 'keep', String(byTitle('Clock')?.decision));

    const album = useStore.getState().addItem({ title: 'Album', room: 'Den', addedBy: 'Helper Test' });
    result.albumId = album.id;
    check('the helper’s capture lands', await drained(uid));

    // A helper deciding is refused by the database. It must be SEEN.
    useStore.getState().decide(byTitle('Lamp')!.id, 'keep');
    await drained(uid);
    const failed = opsSnapshot().find((o) => o.userId === uid && o.status === 'failed');
    check('a helper’s decision is refused, and the refusal is kept visible (not silent)', Boolean(failed), failed?.lastError ?? 'no failed op');
    result.refusal = failed?.lastError;

    useStore.getState().updateItem(album.id!, { title: 'Album (1970s)' });
    check('the helper can edit their own capture', await drained(uid));
  },

  /** Owner, on their own device, sees the helper's capture and deletes the clock. */
  async 'owner-delete'() {
    const uid = await signIn(env.OWNER_EMAIL!);
    const opened = await openHousehold(params.householdId);
    check('owner refreshes the home from the cloud', opened.ok, opened.ok ? '' : opened.error);
    const album = byTitle('Album (1970s)');
    check('owner sees the helper’s edited capture, named for the helper', album?.addedBy === 'Helper Test', String(album?.addedBy));
    check('the helper’s refused decision did not change anything', byTitle('Lamp')?.decision === 'undecided', String(byTitle('Lamp')?.decision));
    useStore.getState().removeItem(byTitle('Clock')!.id);
    check('owner deletes the clock; the outbox drains', await drained(uid));
  },

  /** Helper's device still holds the clock locally. Refreshing must not bring it back. */
  async 'helper-refresh'() {
    await signIn(env.HELPER_EMAIL!);
    check('(setup) the helper device still has the clock from before', Boolean(byTitle('Clock')));
    const opened = await openHousehold(params.householdId);
    check('helper refreshes', opened.ok, opened.ok ? '' : opened.error);
    check('a deletion made elsewhere is NOT resurrected by a device that still had it', !byTitle('Clock'), items().map((i) => i.title).join(','));
  },

  /**
   * Offline capture, then the device changes hands before reconnecting. The
   * helper's queued capture must not go out under the owner, must not be
   * visible to the owner, and must land under the helper when they return.
   */
  async 'helper-offline-switch'() {
    const helperId = await signIn(env.HELPER_EMAIL!);
    await openHousehold(params.householdId);
    (globalThis as G).__offline = true;
    useStore.getState().addItem({ title: 'Offline vase', room: 'Den', addedBy: 'Helper Test' });
    await waitFor('the offline capture to be tried and backed off', () =>
      opsSnapshot().some((o) => o.userId === helperId && o.kind === 'item.create' && o.attempts >= 1 && o.status === 'pending'));
    (globalThis as G).__offline = false;

    await signOut();
    const ownerId = await signIn(env.OWNER_EMAIL!);
    check('after switching to the owner, the helper’s offline capture is not on screen', !byTitle('Offline vase'), items().map((i) => i.title).join(','));
    await sleep(3000);
    const stillWaiting = opsSnapshot().find((o) => o.userId === helperId && o.kind === 'item.create');
    check('the helper’s queued capture was NOT sent under the owner’s session', Boolean(stillWaiting && stillWaiting.status === 'pending'));
    result.ownerSawVase = Boolean(byTitle('Offline vase'));
    result.ownerId = ownerId;

    await signOut();
    await signIn(env.HELPER_EMAIL!);
    check('the helper, signing back in, gets their own copy back — vase included', Boolean(byTitle('Offline vase')), items().map((i) => i.title).join(','));
    check('the helper’s capture sends once they’re back', await drained(helperId, 60000));
  },
};

/* -------------------------------------------------------------------------- boot */

async function main() {
  const name = process.argv[2];
  const scenario = scenarios[name];
  if (!scenario) throw new Error(`unknown scenario ${name}`);
  startAuth();
  startMembership();
  startOutbox();
  await sleep(300); // persisted stores hydrate asynchronously
  await awaitAuthReady();
  await scenario();
}

main()
  .catch((e) => {
    failures++;
    console.log(`CHECK FAIL harness — ${e instanceof Error ? e.stack : String(e)}`);
  })
  .finally(() => {
    console.log(`RESULT ${JSON.stringify({ ...result, failures })}`);
    process.exit(failures ? 1 : 0);
  });
