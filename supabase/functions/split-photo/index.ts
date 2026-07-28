/**
 * split-photo — one group photo in, several proposed items out (Pro only).
 *
 * Claude vision finds the distinct household objects in the shot and returns a
 * name + bounding box for each; this function crops every box out server-side
 * (decode → crop → re-encode, which also drops EXIF/GPS by construction — the
 * same posture as upload-photo) and hands the client cropped JPEGs to review.
 * Nothing is stored here: approved crops enter storage later through the
 * normal upload-photo path.
 *
 * Contract:  POST JSON { imageBase64: string, householdId: uuid }
 * Auth:      verify_jwt ON. RLS confirms the caller belongs to the household
 *            (household_plans SELECT policy = membership).
 * Gating:    household_plans.plan must be 'pro' — each scan is a paid vision
 *            call. Flip FREE_FOR_ALL to true to open it up.
 * Response:  { ok:true, items:[{ name, base64 }] }
 *          | { ok:false, reason?: 'pro_required'|'not_configured'|'no_items', error? }
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { Image } from 'https://deno.land/x/imagescript@1.3.0/mod.ts';

const MODEL = 'claude-sonnet-5';
/** ~8 MB of base64 (≈6 MB JPEG) — matches upload-photo's ceiling. */
const MAX_BASE64_CHARS = 8 * 1024 * 1024;
const MAX_ITEMS = 10;
/** Longest edge of each returned crop. */
const CROP_MAX = 900;
/** Padding added around each detected box, as a fraction of image size. */
const PAD = 0.04;
const FREE_FOR_ALL = false;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const fail = (status: number, error: string, reason?: string) =>
  Response.json({ ok: false, error, ...(reason ? { reason } : {}) }, { status, headers: cors });

const SYSTEM = `You identify the distinct physical household objects in one photo so each can be catalogued as its own inventory item.

Return ONLY a JSON object, no prose:
{"items":[{"name":"<short specific name, e.g. 'Brass table lamp'>","box":[x,y,w,h]}]}

Rules:
- box values are fractions of the image (0..1): x,y = top-left corner, w,h = size. Boxes must tightly contain the object.
- List only real, separately-keepable objects (furniture, dishes, tools, books, ornaments...). Skip walls, floors, fixtures, shadows, and people.
- At most ${MAX_ITEMS} objects — prefer the most significant ones.
- If the photo clearly shows a single object, return that one item.
- If you can identify no objects at all, return {"items":[]}.`;

interface Detected {
  name: string;
  box: [number, number, number, number];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return fail(405, 'POST only.');

  try {
    let body: { imageBase64?: unknown; householdId?: unknown };
    try {
      body = await req.json();
    } catch {
      return fail(400, 'Body must be JSON: { imageBase64, householdId }.');
    }
    const { imageBase64, householdId } = body;
    if (typeof imageBase64 !== 'string' || imageBase64.length === 0) {
      return fail(400, 'imageBase64 is required.');
    }
    if (imageBase64.length > MAX_BASE64_CHARS) {
      return fail(413, 'Photo is too large (max ~6 MB).');
    }
    if (typeof householdId !== 'string' || !/^[0-9a-f-]{36}$/i.test(householdId)) {
      return fail(400, 'householdId must be a UUID.');
    }

    // ---- (a) caller must be signed in and in the household (RLS does the check).
    const authHeader = req.headers.get('Authorization') ?? '';
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } }
    );
    const { data: auth } = await userClient.auth.getUser();
    if (!auth?.user?.id) return fail(401, 'Not signed in.');

    const { data: planRow, error: planErr } = await userClient
      .from('household_plans')
      .select('plan')
      .eq('household_id', householdId)
      .maybeSingle();
    if (planErr) return fail(500, planErr.message);
    if (!planRow) return fail(404, 'Household not found (or you are not a member).');
    if (!FREE_FOR_ALL && planRow.plan !== 'pro') {
      return fail(402, 'Splitting a group photo is a Pro feature.', 'pro_required');
    }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) return fail(503, 'AI photo splitting is not configured yet.', 'not_configured');

    // ---- (b) ask Claude vision for objects + boxes.
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1500,
        system: SYSTEM,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 },
              },
              { type: 'text', text: 'Identify the separate objects in this photo.' },
            ],
          },
        ],
      }),
    });
    const data = (await resp.json()) as {
      content?: { type: string; text?: string }[];
      error?: { message?: string };
    };
    if (!resp.ok) return fail(502, data?.error?.message ?? 'AI request failed.');

    const text = (data.content ?? [])
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text as string)
      .join('\n');
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) return fail(502, 'Could not read the AI response.');
    let parsed: { items?: unknown };
    try {
      parsed = JSON.parse(text.slice(start, end + 1));
    } catch {
      return fail(502, 'AI returned a malformed response.');
    }

    const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
    const detected: Detected[] = (Array.isArray(parsed.items) ? parsed.items : [])
      .slice(0, MAX_ITEMS)
      .flatMap((raw) => {
        const r = raw as { name?: unknown; box?: unknown };
        const b = Array.isArray(r.box) ? r.box.map(Number) : [];
        if (typeof r.name !== 'string' || !r.name.trim() || b.length !== 4 || b.some(Number.isNaN)) {
          return [];
        }
        const [x, y, w, h] = b.map(clamp01) as [number, number, number, number];
        // Reject degenerate slivers — misdetections, not objects.
        if (w < 0.03 || h < 0.03) return [];
        return [{ name: r.name.trim().slice(0, 80), box: [x, y, w, h] as Detected['box'] }];
      });
    if (detected.length === 0) {
      return fail(422, 'No separate objects were found in this photo.', 'no_items');
    }

    // ---- (c) crop each box out of the original (re-encode strips metadata).
    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(atob(imageBase64), (c) => c.charCodeAt(0));
    } catch {
      return fail(400, 'imageBase64 is not valid base64.');
    }
    let img: Image;
    try {
      img = await Image.decode(bytes);
    } catch {
      return fail(422, 'Could not decode the photo — send a JPEG.');
    }

    const items: { name: string; base64: string }[] = [];
    for (const d of detected) {
      const [bx, by, bw, bh] = d.box;
      const x0 = Math.max(0, Math.round((bx - PAD) * img.width));
      const y0 = Math.max(0, Math.round((by - PAD) * img.height));
      const x1 = Math.min(img.width, Math.round((bx + bw + PAD) * img.width));
      const y1 = Math.min(img.height, Math.round((by + bh + PAD) * img.height));
      const w = x1 - x0;
      const h = y1 - y0;
      if (w < 8 || h < 8) continue;
      const crop = img.clone().crop(x0, y0, w, h);
      if (Math.max(crop.width, crop.height) > CROP_MAX) {
        if (crop.width >= crop.height) crop.resize(CROP_MAX, Image.RESIZE_AUTO);
        else crop.resize(Image.RESIZE_AUTO, CROP_MAX);
      }
      const jpeg = await crop.encodeJPEG(78);
      let bin = '';
      for (let i = 0; i < jpeg.length; i += 0x8000) {
        bin += String.fromCharCode(...jpeg.subarray(i, i + 0x8000));
      }
      items.push({ name: d.name, base64: btoa(bin) });
    }
    if (items.length === 0) {
      return fail(422, 'No separate objects were found in this photo.', 'no_items');
    }

    return Response.json({ ok: true, items }, { headers: cors });
  } catch (e) {
    return fail(500, e instanceof Error ? e.message : String(e));
  }
});
