/**
 * E2E multiplayer test against the live Declutter Supabase project.
 * Creates two throwaway users, walks the full loop, then cleans up:
 *   owner: create household → item → chat → invite helper by email
 *   helper: discover invite → accept → read shared items → post chat
 *   owner: sees helper's message
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
const ownerEmail = `e2e-owner-${stamp}@example.com`;
const helperEmail = `e2e-helper-${stamp}@example.com`;
const pw = `Test-${randomUUID()}`;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

let ownerId, helperId, hid;
try {
  // --- setup users ---
  const o = await admin.auth.admin.createUser({ email: ownerEmail, password: pw, email_confirm: true });
  const h = await admin.auth.admin.createUser({ email: helperEmail, password: pw, email_confirm: true });
  ownerId = o.data.user?.id; helperId = h.data.user?.id;
  check('create test users', Boolean(ownerId && helperId));

  // --- owner session ---
  const owner = anon();
  const oSign = await owner.auth.signInWithPassword({ email: ownerEmail, password: pw });
  check('owner signs in', !oSign.error, oSign.error?.message);

  // --- owner creates household (client-supplied uuid, like the app) ---
  hid = randomUUID();
  const hIns = await owner.from('households').insert({ id: hid, name: 'E2E House' });
  check('owner creates household', !hIns.error, hIns.error?.message);

  const planRow = await owner.from('household_plans').select('plan').eq('household_id', hid).maybeSingle();
  check('plan row auto-created (free)', planRow.data?.plan === 'free', JSON.stringify(planRow.data));

  // --- owner adds a decided item (uuid id, like the app) ---
  const itemId = randomUUID();
  const iIns = await owner.from('items').insert({
    id: itemId, household_id: hid, created_by: ownerId,
    title: 'E2E teapot', room: 'Kitchen', decision: 'keep',
    decided_by: ownerId, decided_at: new Date().toISOString(), is_sentimental: true,
  });
  check('owner inserts decided item', !iIns.error, iIns.error?.message);

  const mIns = await owner.from('item_messages').insert({
    id: randomUUID(), item_id: itemId, author: ownerId, author_name: 'Owner', body: 'Is this the one?',
  });
  check('owner posts chat message', !mIns.error, mIns.error?.message);

  // --- owner invites helper (the join.ts createCloudInvite shape) ---
  const inv = await owner.from('household_members').insert({
    household_id: hid, invited_email: helperEmail, role: 'contributor', status: 'invited',
  });
  check('owner creates cloud invitation', !inv.error, inv.error?.message);

  // --- helper session ---
  const helper = anon();
  const hSign = await helper.auth.signInWithPassword({ email: helperEmail, password: pw });
  check('helper signs in', !hSign.error, hSign.error?.message);

  // Before accepting: helper must NOT see the household's items.
  const before = await helper.from('items').select('id').eq('household_id', hid);
  check('helper sees nothing before accepting', (before.data ?? []).length === 0);

  // --- discovery + accept ---
  const pending = await helper.rpc('my_pending_invites');
  check('helper discovers the invite', (pending.data ?? []).some(r => r.household_id === hid), JSON.stringify(pending.data));

  const acc = await helper.rpc('accept_invite', { p_household_id: hid });
  check('helper accepts the invite', !acc.error, acc.error?.message);

  // --- helper reads the shared household ---
  const items = await helper.from('items').select('id,title,decision').eq('household_id', hid);
  check('helper reads shared items', (items.data ?? []).some(i => i.title === 'E2E teapot'));

  const msgs = await helper.from('item_messages').select('body').eq('item_id', itemId);
  check('helper reads chat', (msgs.data ?? []).some(m => m.body === 'Is this the one?'));

  // --- helper posts chat + adds an undecided item ---
  const hMsg = await helper.from('item_messages').insert({
    id: randomUUID(), item_id: itemId, author: helperId, author_name: 'Helper', body: 'Yes! From Delft.',
  });
  check('helper posts chat', !hMsg.error, hMsg.error?.message);

  const hItem = await helper.from('items').insert({
    id: randomUUID(), household_id: hid, created_by: helperId, title: 'Helper find', decision: 'undecided',
  });
  check('helper adds undecided item', !hItem.error, hItem.error?.message);

  // Helper must NOT be able to decide (server authority).
  const hDecide = await helper.from('items').update({
    decision: 'keep', decided_by: helperId, decided_at: new Date().toISOString(),
  }).eq('id', itemId).select();
  const decideBlocked = Boolean(hDecide.error) || (hDecide.data ?? []).length === 0;
  check('helper CANNOT decide (owner authority enforced)', decideBlocked, hDecide.error?.message ?? 'silently filtered');

  // --- owner sees helper's contributions ---
  const oMsgs = await owner.from('item_messages').select('body').eq('item_id', itemId);
  check('owner sees helper chat', (oMsgs.data ?? []).some(m => m.body === 'Yes! From Delft.'));
  const oItems = await owner.from('items').select('title').eq('household_id', hid);
  check('owner sees helper item', (oItems.data ?? []).some(i => i.title === 'Helper find'));
} catch (e) {
  check('unexpected exception', false, e.message);
} finally {
  // --- cleanup ---
  if (hid) await admin.from('households').delete().eq('id', hid);
  if (ownerId) await admin.auth.admin.deleteUser(ownerId);
  if (helperId) await admin.auth.admin.deleteUser(helperId);
  console.log('cleanup done');
}

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
