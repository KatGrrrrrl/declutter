/** Probe create-checkout with a real user JWT and print the raw error body. */
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

const URL = 'https://xkzuoogmcfrxicmoybzp.supabase.co';
const PUBLISHABLE = 'sb_publishable_jvgjfZky19YKaFVrH29OWw_6srBfiP1';
const SERVICE = process.env.SERVICE_KEY;
const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
const email = `probe-${Date.now()}@example.com`;
const pw = `Test-${randomUUID()}`;
const { data: u } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true });
const c = createClient(URL, PUBLISHABLE, { auth: { persistSession: false } });
const { data: s } = await c.auth.signInWithPassword({ email, password: pw });
const hid = randomUUID();
await c.from('households').insert({ id: hid, name: 'Probe House' });
const resp = await fetch(`${URL}/functions/v1/create-checkout`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${s.session.access_token}`,
    apikey: PUBLISHABLE,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ cycle: 'monthly', householdId: hid }),
});
console.log('status:', resp.status);
console.log('body:', (await resp.text()).slice(0, 500));
await admin.from('households').delete().eq('id', hid);
await admin.auth.admin.deleteUser(u.user.id);
console.log('cleanup done');
