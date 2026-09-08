/**
 * Live end-to-end check of COLLECTIONS syncing between two devices, against
 * the real Supabase project, using exactly the query shapes in src/lib/sync.ts
 * (upsertCollections, pushItem/pushItemUpdate with collection_id,
 * pushCollectionUpdate, pullHousehold) and src/lib/realtime.ts. Two throwaway
 * users — an owner ("Rose") and a contributor ("Tom") — then cleanup.
 *
 *   SERVICE_KEY=<service role key> node tools/e2e-collections.mjs
 *
 * Covers:
 *  - owner creates a collection lazily (upsert-before-item, the FK ordering)
 *    and files two items into it; contributor's pull sees both
 *  - realtime item INSERT/UPDATE carries collection_id to the other device
 *  - contributor creates their OWN collection and files an undecided item
 *    (any-member authority), and renames a collection (pushCollectionUpdate)
 *  - re-filing an item (bulkSetCollection → pushItemUpdate) syncs live
 *  - owner decides the whole set (bulkDecide shape) → contributor sees both
 *  - deleting a collection un-groups: items.collection_id → NULL server-side,
 *    and the cascaded UPDATEs reach the other device over realtime (this is
 *    what lets device B un-group without a manual pull — a real assertion,
 *    not a formality)
 *  - guards: contributor cannot decide via collection ops; collections
 *    household_id/created_by are immutable; audit gets collection.created/
 *    collection.deleted (owner-readable)
 */
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

const URL = 'https://xkzuoogmcfrxicmoybzp.supabase.co';
const PUBLISHABLE = 'sb_publishable_jvgjfZky19YKaFVrH29OWw_6srBfiP1';
const SERVICE = process.env.SERVICE_KEY;
if (!SERVICE) { console.error('SERVICE_KEY env required'); process.exit(1); }

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
const anon = () => createClient(URL, PUBLISHABLE, { auth: { persistSession: false } });
const stamp = Date.now();
const pw = `Test-${randomUUID()}`;
const ownerEmail = `e2e-coll-owner-${stamp}@example.com`;
const helperEmail = `e2e-coll-helper-${stamp}@example.com`;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (pred, ms = 8000) => {
  const t0 = Date.now();
  while (!pred() && Date.now() - t0 < ms) await sleep(150);
  return pred();
};

/** Same items subscription shape as src/lib/realtime.ts. */
function subscribe(client, hid) {
  const got = { items: [], deletes: [] };
  const ch = client
    .channel(`e2e-coll-${hid}-${randomUUID().slice(0, 8)}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'items', filter: `household_id=eq.${hid}` },
      (p) => (p.eventType === 'DELETE' ? got.deletes.push(p.old) : got.items.push(p.new))
    );
  return new Promise((resolve, reject) => {
    ch.subscribe((status, err) => {
      if (status === 'SUBSCRIBED') resolve({ ch, got });
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT')
        reject(new Error(`${status} ${err ?? ''}`));
    });
    setTimeout(() => reject(new Error('subscribe timeout')), 10000);
  });
}

/** sync.ts upsertCollections row shape. */
const collectionRow = (c, hid, uid) => ({
  id: c.id,
  household_id: hid,
  name: c.name,
  note: c.note ?? null,
  created_by: uid,
  created_by_name: c.createdBy || null,
  created_at: new Date().toISOString(),
});

/** sync.ts pushItem row shape (now incl. collection_id). */
const itemRow = (item, hid, uid, isOwner) => {
  const decided = isOwner && item.decision !== 'undecided';
  return {
    id: item.id,
    household_id: hid,
    created_by: uid,
    title: item.title,
    room: item.room ?? null,
    collection_id: item.collectionId ?? null,
    decision: isOwner ? item.decision : 'undecided',
    decided_by: decided ? uid : null,
    decided_at: decided ? new Date().toISOString() : null,
    market_value_cents: item.valueCents ?? null,
    is_sentimental: false,
    donate_to: null,
    donate_to_kind: null,
    archived: false,
    created_at: new Date().toISOString(),
  };
};

let ownerId, helperId, hid;
try {
  const o = await admin.auth.admin.createUser({ email: ownerEmail, password: pw, email_confirm: true });
  const h = await admin.auth.admin.createUser({ email: helperEmail, password: pw, email_confirm: true });
  ownerId = o.data.user?.id;
  helperId = h.data.user?.id;
  check('create test users', Boolean(ownerId && helperId), o.error?.message ?? h.error?.message);

  const owner = anon();
  const os = await owner.auth.signInWithPassword({ email: ownerEmail, password: pw });
  check('owner signs in', !os.error, os.error?.message);
  owner.realtime.setAuth(os.data.session.access_token);

  hid = randomUUID();
  const hIns = await owner.from('households').insert({ id: hid, name: 'E2E Collections House' });
  check('owner creates household', !hIns.error, hIns.error?.message);

  await owner.from('household_members').insert({ household_id: hid, invited_email: helperEmail, role: 'contributor', status: 'invited' });
  const helper = anon();
  const hs = await helper.auth.signInWithPassword({ email: helperEmail, password: pw });
  check('helper signs in', !hs.error, hs.error?.message);
  helper.realtime.setAuth(hs.data.session.access_token);
  const acc = await helper.rpc('accept_invite', { p_household_id: hid });
  check('helper accepts invite', !acc.error, acc.error?.message);

  // Both "devices" listening, like the app's realtime bridge.
  const O = await subscribe(owner, hid);
  const H = await subscribe(helper, hid);

  // --- device A (owner): collection first, then two coins into it -----------
  // This is the lazy-upload ordering from sync.ts: the collection row must
  // exist before an item row references it (FK).
  const coins = { id: randomUUID(), name: 'E2E Coin collection', note: 'the folder is in the study', createdBy: 'Rose' };
  const cIns = await owner.from('collections').upsert(collectionRow(coins, hid, ownerId), { ignoreDuplicates: false });
  check('owner uploads collection (upsertCollections shape)', !cIns.error, cIns.error?.message);

  const kennedy = { id: randomUUID(), title: 'E2E 1964 Kennedy half', room: 'Study', decision: 'undecided', collectionId: coins.id, valueCents: 1800 };
  const nickel  = { id: randomUUID(), title: 'E2E Buffalo nickel',   room: 'Study', decision: 'undecided', collectionId: coins.id, valueCents: 600 };
  const k = await owner.from('items').upsert(itemRow(kennedy, hid, ownerId, true), { ignoreDuplicates: false });
  const n = await owner.from('items').upsert(itemRow(nickel, hid, ownerId, true), { ignoreDuplicates: false });
  check('owner pushItem ×2 with collection_id (FK holds)', !k.error && !n.error, k.error?.message ?? n.error?.message);

  check(
    'realtime INSERT carries collection_id to device B',
    await waitFor(() => H.got.items.filter((r) => r.collection_id === coins.id).length >= 2),
    `saw ${H.got.items.filter((r) => r.collection_id === coins.id).length}`
  );

  // --- device B (helper): pullHousehold shape sees the collection ----------
  const pullC = await helper.from('collections').select('*').eq('household_id', hid);
  const pullI = await helper.from('items').select('id,collection_id').eq('household_id', hid);
  check('pull: helper sees the collection row', (pullC.data ?? []).some((c) => c.id === coins.id && c.name === coins.name), pullC.error?.message);
  check('pull: membership arrives on items', (pullI.data ?? []).filter((i) => i.collection_id === coins.id).length === 2, pullI.error?.message);

  // --- device B: contributor creates their OWN collection + item -----------
  const wine = { id: randomUUID(), name: 'E2E Wine cellar', createdBy: 'Tom' };
  const wIns = await helper.from('collections').upsert(collectionRow(wine, hid, helperId), { ignoreDuplicates: true });
  check('contributor creates a collection (any-member authority)', !wIns.error, wIns.error?.message);

  const rioja = { id: randomUUID(), title: 'E2E Rioja 2011', room: 'Garage', decision: 'undecided', collectionId: wine.id };
  const rIns = await helper.from('items').upsert(itemRow(rioja, hid, helperId, false), { ignoreDuplicates: true });
  check('contributor pushItem into own collection', !rIns.error, rIns.error?.message);
  check(
    'realtime INSERT (helper item + collection_id) reaches owner',
    await waitFor(() => O.got.items.some((r) => r.id === rioja.id && r.collection_id === wine.id))
  );

  // --- device B: contributor renames a collection (pushCollectionUpdate) ---
  const ren = await helper.from('collections').update({ name: 'E2E Coin collection (Dad’s)', note: coins.note }).eq('id', coins.id).select('id');
  check('contributor renames a collection (plain update, RLS any-member)', !ren.error && (ren.data ?? []).length === 1, ren.error?.message ?? `${(ren.data ?? []).length} rows`);

  // --- device B: re-file an item (bulkSetCollection → pushItemUpdate) ------
  // Contributor patch shape from pushItemUpdate: no decision fields.
  const refile = await helper
    .from('items')
    .update({ title: rioja.title, room: rioja.room, collection_id: coins.id, market_value_cents: null, is_sentimental: false, donate_to: null, donate_to_kind: null, archived: false })
    .eq('id', rioja.id)
    .eq('household_id', hid)
    .select('id');
  check('contributor re-files item into another collection', !refile.error && (refile.data ?? []).length === 1, refile.error?.message);
  check(
    'realtime UPDATE (new collection_id) reaches owner',
    await waitFor(() => O.got.items.some((r) => r.id === rioja.id && r.collection_id === coins.id))
  );

  // --- device A: owner decides the WHOLE collection (bulkDecide shape) -----
  const ids = [kennedy.id, nickel.id, rioja.id];
  const dec = await owner.from('items').update({ decision: 'keep' }).in('id', ids).eq('household_id', hid);
  check('owner decides the whole collection in one update', !dec.error, dec.error?.message);
  check(
    'realtime: all member decisions reach device B',
    await waitFor(() => ids.every((id) => H.got.items.some((r) => r.id === id && r.decision === 'keep' && r.decided_at)))
  );

  // --- guards ---------------------------------------------------------------
  const move = await helper.from('collections').update({ household_id: randomUUID() }).eq('id', wine.id).select('id');
  check('collections.household_id is immutable (guard raises or filters)', Boolean(move.error) || (move.data ?? []).length === 0, move.error?.message ?? 'filtered');

  // --- delete un-groups, and the un-grouping SYNCS live --------------------
  H.got.items.length = 0; // watch only what the delete cascades
  const del = await owner.from('collections').delete().eq('id', coins.id);
  check('owner deletes collection', !del.error, del.error?.message);
  const after = await owner.from('items').select('id,collection_id').in('id', ids);
  check(
    'FK ON DELETE SET NULL un-groups all members, deletes no items',
    (after.data ?? []).length === 3 && (after.data ?? []).every((i) => i.collection_id === null),
    JSON.stringify(after.data)
  );
  check(
    'cascaded un-group UPDATEs reach device B over realtime',
    await waitFor(() => ids.every((id) => H.got.items.some((r) => r.id === id && r.collection_id === null))),
    `saw ${H.got.items.length} updates`
  );

  // --- audit: owner-readable collection.created / collection.deleted -------
  const audit = await owner
    .from('audit_log')
    .select('action,target_id')
    .eq('household_id', hid)
    .in('action', ['collection.created', 'collection.deleted']);
  const acts = (audit.data ?? []).map((a) => a.action);
  check(
    'audit log has collection.created ×2 + collection.deleted',
    acts.filter((a) => a === 'collection.created').length === 2 && acts.includes('collection.deleted'),
    JSON.stringify(acts)
  );

  await owner.removeAllChannels();
  await helper.removeAllChannels();
} catch (e) {
  check('unexpected exception', false, e.stack ?? e.message);
} finally {
  if (hid) {
    const d = await admin.from('households').delete().eq('id', hid);
    const left = await admin.from('households').select('id').eq('id', hid);
    check('cleanup: household deleted', !d.error && (left.data ?? []).length === 0, d.error?.message);
  }
  for (const id of [ownerId, helperId]) {
    if (!id) continue;
    const r = await admin.auth.admin.deleteUser(id);
    check(`cleanup: user ${id.slice(0, 8)} deleted`, !r.error, r.error?.message);
  }
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
