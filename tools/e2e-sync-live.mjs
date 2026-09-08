/**
 * Live end-to-end check of the app's SAVE / EDIT / NOTIFY paths, against the
 * real Supabase project, using exactly the query shapes in src/lib/sync.ts,
 * store.ts (addMessage) and realtime.ts. Two throwaway users, then cleanup.
 *
 *   SERVICE_KEY=<service role key> node tools/e2e-sync-live.mjs
 *
 * Covers: pushItem (owner + contributor), pushItemUpdate (both roles, incl. a
 * contributor trying to decide), realtime INSERT/UPDATE/DELETE on items and
 * INSERT on item_messages, notification_prefs upsert + notify-item-added
 * fan-out, and household presence (who else is online).
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
const ownerEmail = `e2e-sync-owner-${stamp}@example.com`;
const helperEmail = `e2e-sync-helper-${stamp}@example.com`;

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

/** Same subscription shape as src/lib/realtime.ts, plus presence. */
function subscribe(client, hid, me) {
  const got = { items: [], deletes: [], messages: [], others: [] };
  const ch = client
    .channel(`household-${hid}`, { config: { presence: { key: me.uid } } })
    .on('presence', { event: 'sync' }, () => {
      const seen = new Map();
      for (const metas of Object.values(ch.presenceState()))
        for (const p of metas) if (p.uid !== me.uid) seen.set(p.uid, p.name);
      got.others = [...seen.values()];
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'item_messages' }, (p) =>
      got.messages.push(p.new)
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'items', filter: `household_id=eq.${hid}` },
      (p) => (p.eventType === 'DELETE' ? got.deletes.push(p.old) : got.items.push(p.new))
    );
  return new Promise((resolve, reject) => {
    ch.subscribe(async (status, err) => {
      if (status === 'SUBSCRIBED') {
        await ch.track(me);
        resolve({ ch, got });
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        reject(new Error(`${status} ${err ?? ''}`));
      }
    });
    setTimeout(() => reject(new Error('subscribe timeout')), 10000);
  });
}

/** sync.ts pushItem row shape. */
const itemRow = (item, hid, uid, isOwner) => {
  const decided = isOwner && item.decision !== 'undecided';
  return {
    id: item.id,
    household_id: hid,
    created_by: uid,
    title: item.title,
    room: item.room ?? null,
    decision: isOwner ? item.decision : 'undecided',
    decided_by: decided ? uid : null,
    decided_at: decided ? new Date().toISOString() : null,
    market_value_cents: null,
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
  const hIns = await owner.from('households').insert({ id: hid, name: 'E2E Sync House' });
  check('owner creates household', !hIns.error, hIns.error?.message);

  // --- owner pushItem (capture-and-keep, like a decider capturing) ---
  const teapot = { id: randomUUID(), title: 'E2E teapot', room: 'Kitchen', decision: 'keep' };
  const tIns = await owner.from('items').upsert(itemRow(teapot, hid, ownerId, true), { ignoreDuplicates: false });
  check('owner pushItem (decided)', !tIns.error, tIns.error?.message);
  const tRow = await owner.from('items').select('decided_by,decided_at').eq('id', teapot.id).single();
  check('trigger stamped decided_by/decided_at', tRow.data?.decided_by === ownerId && !!tRow.data?.decided_at);

  // --- invite + accept ---
  await owner.from('household_members').insert({ household_id: hid, invited_email: helperEmail, role: 'contributor', status: 'invited' });
  const helper = anon();
  const hs = await helper.auth.signInWithPassword({ email: helperEmail, password: pw });
  check('helper signs in', !hs.error, hs.error?.message);
  helper.realtime.setAuth(hs.data.session.access_token);
  const acc = await helper.rpc('accept_invite', { p_household_id: hid });
  check('helper accepts invite', !acc.error, acc.error?.message);

  // --- both subscribe (realtime + presence) ---
  const O = await subscribe(owner, hid, { uid: ownerId, name: 'Rose' });
  const H = await subscribe(helper, hid, { uid: helperId, name: 'Tom' });
  check('presence: owner sees helper', await waitFor(() => O.got.others.includes('Tom')), JSON.stringify(O.got.others));
  check('presence: helper sees owner', await waitFor(() => H.got.others.includes('Rose')), JSON.stringify(H.got.others));

  // --- owner pushItemUpdate: title/room/archived ---
  const oUpd = await owner
    .from('items')
    .update({ title: 'E2E teapot (blue)', room: 'Kitchen', archived: true, decision: 'keep' })
    .eq('id', teapot.id)
    .eq('household_id', hid);
  check('owner pushItemUpdate', !oUpd.error, oUpd.error?.message);
  check(
    'realtime UPDATE reaches helper (title+archived)',
    await waitFor(() => H.got.items.some((r) => r.id === teapot.id && r.title === 'E2E teapot (blue)' && r.archived === true))
  );

  // --- contributor edits an owner's item (allowed by items_update_member) ---
  const hUpd = await helper
    .from('items')
    .update({ title: 'E2E teapot (Delft)', archived: false })
    .eq('id', teapot.id)
    .eq('household_id', hid)
    .select('id');
  check(
    'contributor pushItemUpdate on shared item',
    !hUpd.error && (hUpd.data ?? []).length === 1,
    hUpd.error?.message ?? `${(hUpd.data ?? []).length} rows`
  );
  check('realtime UPDATE reaches owner', await waitFor(() => O.got.items.some((r) => r.id === teapot.id && r.title === 'E2E teapot (Delft)')));

  // --- contributor tries to decide (must be refused by items_guard) ---
  const hDecide = await helper.from('items').update({ decision: 'donate' }).eq('id', teapot.id).select('id');
  check('contributor CANNOT decide', Boolean(hDecide.error) || (hDecide.data ?? []).length === 0, hDecide.error?.message ?? 'filtered');

  // --- contributor pushItem (undecided) -> owner sees INSERT live ---
  const find = { id: randomUUID(), title: 'Helper find', room: 'Attic', decision: 'undecided' };
  const fIns = await helper.from('items').upsert(itemRow(find, hid, helperId, false), { ignoreDuplicates: true });
  check('contributor pushItem (undecided)', !fIns.error, fIns.error?.message);
  check('realtime INSERT reaches owner', await waitFor(() => O.got.items.some((r) => r.id === find.id)));

  // Re-pushing the same id as a contributor is a no-op (ignoreDuplicates):
  // contributor EDITS must go through pushItemUpdate, which the app does.
  await helper.from('items').upsert({ ...itemRow(find, hid, helperId, false), title: 'renamed via pushItem' }, { ignoreDuplicates: true });
  const fRow = await helper.from('items').select('title').eq('id', find.id).single();
  check('contributor re-pushItem does not overwrite (by design)', fRow.data?.title === 'Helper find', fRow.data?.title);

  // --- owner decides the helper's item -> helper sees decision live ---
  const dec = await owner.from('items').update({ decision: 'keep' }).eq('id', find.id).eq('household_id', hid);
  check('owner decides contributor item', !dec.error, dec.error?.message);
  check(
    'realtime UPDATE (decision) reaches helper',
    await waitFor(() => H.got.items.some((r) => r.id === find.id && r.decision === 'keep' && r.decided_at))
  );

  // --- chat: store.addMessage shape ---
  const msgId = randomUUID();
  const m = await helper.from('item_messages').insert({
    id: msgId,
    item_id: teapot.id,
    author: helperId,
    author_name: 'Tom',
    body: 'Was this Grandma’s?',
    created_at: new Date().toISOString(),
  });
  check('helper addMessage', !m.error, m.error?.message);
  check('realtime message reaches owner', await waitFor(() => O.got.messages.some((r) => r.id === msgId)));

  // --- notifications: helper wants instant emails; owner adds -> fan-out ---
  const pref = await helper.from('notification_prefs').upsert(
    { user_id: helperId, household_id: hid, mode: 'instant', email: helperEmail, updated_at: new Date().toISOString() },
    { onConflict: 'user_id,household_id' }
  );
  check('helper setNotifyPref(instant)', !pref.error, pref.error?.message);
  const ping = await owner.functions.invoke('notify-item-added', {
    body: { itemId: teapot.id, itemTitle: teapot.title, householdId: hid, addedBy: 'Rose' },
  });
  const body = ping.data ?? (ping.error?.context ? await ping.error.context.json().catch(() => null) : null);
  const configured = body?.ok === true;
  check(
    'notify-item-added responds',
    configured || body?.error === 'email_not_configured',
    configured ? `recipients=${body.recipients} sent=${body.sent} failed=${body.failed}` : body?.error ?? ping.error?.message
  );
  if (configured) check('fan-out excludes the adder, includes helper', body.recipients === 1, `recipients=${body.recipients}`);

  // --- delete: owner removes -> helper gets DELETE with the id ---
  const del = await owner.from('items').delete().eq('id', teapot.id);
  check('owner removeItem', !del.error, del.error?.message);
  check(
    'realtime DELETE reaches helper with id (replica identity full)',
    await waitFor(() => H.got.deletes.some((r) => r.id === teapot.id)),
    JSON.stringify(H.got.deletes)
  );

  // --- presence leave ---
  await helper.removeAllChannels();
  check('presence: owner sees helper leave', await waitFor(() => !O.got.others.includes('Tom'), 10000), JSON.stringify(O.got.others));
  await owner.removeAllChannels();
} catch (e) {
  check('unexpected exception', false, e.stack ?? e.message);
} finally {
  // Cleanup, verified: earlier scripts left "E2E House" rows behind.
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
