/**
 * upload-photo — the ONLY write path into the private `item-photos` bucket.
 *
 * There is deliberately no client INSERT policy on storage.objects (see the
 * Phase-1 migration §7): photos must pass through here so EXIF/GPS metadata is
 * stripped server-side before any byte touches storage.
 *
 * Contract:  POST JSON { itemId: string, base64: string }   (a JPEG)
 * Auth:      verify_jwt is ON (default) — the gateway rejects anonymous calls;
 *            authorization (may THIS user touch THIS item?) is delegated to
 *            RLS via a user-scoped client (items SELECT policy = household
 *            membership).
 * Pipeline:  decode JPEG → (downscale if wider than 1600px) → re-encode JPEG.
 *            Decoding to raw pixels and re-encoding drops every metadata
 *            segment — EXIF, GPS, thumbnails, ICC — by construction.
 * Storage:   service-role upload to item-photos/{household_id}/{item_id}/{uuid}.jpg
 *            plus a public.item_photos metadata row (exif_stripped: true,
 *            is_primary when it is the item's first photo).
 * Response:  { ok: true, storagePath } | { ok: false, error }
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { Image } from 'https://deno.land/x/imagescript@1.3.0/mod.ts';

/** ~8 MB of base64 (≈6 MB of JPEG) — plenty for a phone photo at quality 0.7. */
const MAX_BASE64_CHARS = 8 * 1024 * 1024;
/** Cap the long-run storage cost: downscale anything wider than this. */
const MAX_WIDTH = 1600;
const BUCKET = 'item-photos';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const fail = (status: number, error: string) =>
  Response.json({ ok: false, error }, { status, headers: cors });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return fail(405, 'POST only.');

  try {
    let body: { itemId?: unknown; base64?: unknown };
    try {
      body = await req.json();
    } catch {
      return fail(400, 'Body must be JSON: { itemId, base64 }.');
    }
    const { itemId, base64 } = body;
    if (typeof itemId !== 'string' || !/^[0-9a-f-]{36}$/i.test(itemId)) {
      return fail(400, 'itemId must be a UUID.');
    }
    if (typeof base64 !== 'string' || base64.length === 0) {
      return fail(400, 'base64 (JPEG) is required.');
    }
    if (base64.length > MAX_BASE64_CHARS) {
      return fail(413, 'Photo is too large (max ~6 MB).');
    }

    // ---- (a) authorization via RLS: user-scoped client from the caller's JWT.
    const authHeader = req.headers.get('Authorization') ?? '';
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } }
    );

    const { data: auth } = await userClient.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) return fail(401, 'Not signed in.');

    // RLS does the real check: items SELECT requires active household membership.
    const { data: item, error: itemErr } = await userClient
      .from('items')
      .select('id, household_id')
      .eq('id', itemId)
      .maybeSingle();
    if (itemErr) return fail(500, itemErr.message);
    if (!item) return fail(404, 'Item not found (or you are not in its household).');

    // ---- (b) strip metadata: decode to raw pixels, re-encode a clean JPEG.
    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    } catch {
      return fail(400, 'base64 payload is not valid base64.');
    }

    let clean: Uint8Array;
    let width: number;
    let height: number;
    try {
      const img = await Image.decode(bytes);
      if (img.width > MAX_WIDTH) img.resize(MAX_WIDTH, Image.RESIZE_AUTO);
      width = img.width;
      height = img.height;
      clean = await img.encodeJPEG(80);
    } catch {
      return fail(422, 'Could not decode the photo — send a JPEG.');
    }

    // ---- (c) service-role upload to the private bucket.
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    const storagePath = `${item.household_id}/${item.id}/${crypto.randomUUID()}.jpg`;
    const { error: upErr } = await admin.storage
      .from(BUCKET)
      .upload(storagePath, clean, { contentType: 'image/jpeg' });
    if (upErr) return fail(500, `Storage upload failed: ${upErr.message}`);

    // ---- (d) metadata row; primary if it is the item's first photo.
    const { count } = await admin
      .from('item_photos')
      .select('id', { count: 'exact', head: true })
      .eq('item_id', item.id);
    const { error: insErr } = await admin.from('item_photos').insert({
      item_id: item.id,
      created_by: uid,
      storage_path: storagePath,
      width,
      height,
      exif_stripped: true,
      is_primary: (count ?? 0) === 0,
    });
    if (insErr) {
      // Keep bytes and rows in sync: a photo without a row is unreachable.
      await admin.storage.from(BUCKET).remove([storagePath]);
      return fail(500, `Photo record failed: ${insErr.message}`);
    }

    // ---- (e)
    return Response.json({ ok: true, storagePath }, { headers: cors });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return fail(500, msg);
  }
});
