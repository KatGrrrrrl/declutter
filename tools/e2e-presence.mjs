// Transport check: can two anonymous clients see each other via Realtime presence
// on this project (publishable key, public channel)? No auth or service key needed.
import { createClient } from '@supabase/supabase-js';
const URL = 'https://xkzuoogmcfrxicmoybzp.supabase.co';
const KEY = 'sb_publishable_jvgjfZky19YKaFVrH29OWw_6srBfiP1';
const mk = () => createClient(URL, KEY, { auth: { persistSession: false } });
const a = mk(), b = mk();
const seen = { a: [], b: [] };
const join = (client, who, name) => new Promise((resolve, reject) => {
  const ch = client.channel('e2e-presence-check', { config: { presence: { key: name } } });
  ch.on('presence', { event: 'sync' }, () => {
    seen[who] = Object.values(ch.presenceState()).flat().map((p) => p.name);
  });
  ch.subscribe(async (status, err) => {
    if (status === 'SUBSCRIBED') { await ch.track({ name, at: Date.now() }); resolve(ch); }
    else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') reject(new Error(`${who}: ${status} ${err ?? ''}`));
  });
  setTimeout(() => reject(new Error(`${who}: subscribe timeout`)), 10000);
});
try {
  const [ca, cb] = await Promise.all([join(a, 'a', 'Rose'), join(b, 'b', 'Tom')]);
  await new Promise((r) => setTimeout(r, 2500));
  console.log('A sees:', seen.a, ' B sees:', seen.b);
  const ok = seen.a.includes('Tom') && seen.b.includes('Rose');
  console.log(ok ? 'PASS presence: both clients see each other' : 'FAIL presence');
  // Leaving the way the app does (channel removed on stopRealtime/sign-out).
  await b.removeAllChannels();
  const t0 = Date.now();
  while (seen.a.includes('Tom') && Date.now() - t0 < 10000) await new Promise((r) => setTimeout(r, 250));
  const left = !seen.a.includes('Tom');
  console.log(`after B leaves (${Date.now() - t0}ms), A sees:`, seen.a, left ? '(PASS leave)' : '(FAIL leave)');
  await a.removeAllChannels();
  process.exit(ok && left ? 0 : 1);
} catch (e) { console.error('ERROR', e.message); process.exit(2); }
