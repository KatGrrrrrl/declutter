/**
 * estimate-value — AI resale-value estimate for a kept item (Pro only).
 *
 * Given an item's photo + description, Claude identifies the piece and uses the
 * web_search tool to find CURRENT comparable secondhand listings, then returns
 * a realistic resale range. This is an informal estimate, never an appraisal.
 *
 * Contract:  POST JSON { itemId: uuid, imageBase64?: string, imageMediaType?: string }
 *              imageBase64 is only needed for a local-only / not-yet-uploaded
 *              photo; otherwise the server pulls the item's stored photo.
 * Auth:      verify_jwt ON (gateway rejects anonymous). RLS confirms the caller
 *            is in the item's household (items SELECT policy).
 * Gating:    household_plans.plan for the item's household must be 'pro'.
 * Response:  { ok:true, estimate:{ best, low, high, currency, confidence,
 *              rationale, comparables:[{title, price, source}] } }
 *          | { ok:false, reason?: 'pro_required'|'not_configured'|'no_input', error? }
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { encodeBase64 } from 'jsr:@std/encoding@1/base64';

const BUCKET = 'item-photos';
const MODEL = 'claude-sonnet-5';
/** ~8 MB of base64 (≈6 MB image) — matches upload-photo's ceiling. */
const MAX_BASE64_CHARS = 8 * 1024 * 1024;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const fail = (status: number, error: string, reason?: string) =>
  Response.json({ ok: false, error, ...(reason ? { reason } : {}) }, { status, headers: cors });

const SYSTEM = `You estimate the current US secondhand / resale market value of household and estate items from a photo and a short description.

Identify the item as specifically as you can (maker, model, era, material, pattern). Use the web_search tool to find CURRENT comparable listings — prefer completed/sold results (eBay sold, auction results) and active resale marketplaces. Base the range on a used item in average condition unless the photo clearly shows otherwise.

Return ONLY a single JSON object, no prose before or after, with exactly this shape:
{"best": <whole USD>, "low": <whole USD>, "high": <whole USD>, "currency": "USD", "confidence": "low"|"medium"|"high", "rationale": "<=240 chars, plain language for a non-expert", "comparables": [{"title": "<what sold>", "price": <whole USD>, "source": "<site/marketplace>"}]}

Rules:
- Values are whole US dollars (numbers, no "$" or commas).
- Include up to 3 comparables that actually informed the range; [] if you found none.
- If you cannot identify the item, set confidence "low" and give your best generic guess from the description.
- This is an informal estimate, never a professional appraisal. Do not claim certainty.`;

interface AnthropicBlock {
  type: string;
  text?: string;
}
interface AnthropicResponse {
  content?: AnthropicBlock[];
  stop_reason?: string;
  error?: { message?: string };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return fail(405, 'POST only.');

  try {
    let body: { itemId?: unknown; imageBase64?: unknown; imageMediaType?: unknown };
    try {
      body = await req.json();
    } catch {
      return fail(400, 'Body must be JSON: { itemId }.');
    }
    const { itemId, imageBase64, imageMediaType } = body;
    if (typeof itemId !== 'string' || !/^[0-9a-f-]{36}$/i.test(itemId)) {
      return fail(400, 'itemId must be a UUID.');
    }
    if (imageBase64 != null && (typeof imageBase64 !== 'string' || imageBase64.length > MAX_BASE64_CHARS)) {
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

    // items SELECT is RLS-gated to household membership — this is the real check.
    const { data: item, error: itemErr } = await userClient
      .from('items')
      .select('id, household_id, title, room, tags')
      .eq('id', itemId)
      .maybeSingle();
    if (itemErr) return fail(500, itemErr.message);
    if (!item) return fail(404, 'Item not found (or you are not in its household).');

    // ---- (b) Pro gate: the item's household must be on the paid plan.
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    const { data: planRow } = await admin
      .from('household_plans')
      .select('plan')
      .eq('household_id', item.household_id)
      .maybeSingle();
    if (planRow?.plan !== 'pro') {
      return fail(402, 'AI valuation is a Pro feature.', 'pro_required');
    }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) return fail(503, 'AI valuation is not configured yet.', 'not_configured');

    // ---- (c) resolve an image: caller-supplied bytes, else the stored photo.
    let imgB64: string | null = typeof imageBase64 === 'string' ? imageBase64 : null;
    let mediaType = typeof imageMediaType === 'string' ? imageMediaType : 'image/jpeg';
    if (!imgB64) {
      const { data: photo } = await admin
        .from('item_photos')
        .select('storage_path')
        .eq('item_id', item.id)
        .order('is_primary', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (photo?.storage_path) {
        const dl = await admin.storage.from(BUCKET).download(photo.storage_path);
        if (dl.data) {
          imgB64 = encodeBase64(new Uint8Array(await dl.data.arrayBuffer()));
          mediaType = 'image/jpeg';
        }
      }
    }

    // ---- (d) build the request. A description alone still yields an estimate.
    const tags = Array.isArray(item.tags) ? (item.tags as string[]).join(', ') : '';
    const desc =
      `Item: ${item.title}\n` +
      `Room/context: ${item.room}\n` +
      (tags ? `Tags: ${tags}\n` : '') +
      `Estimate its current US secondhand resale value.`;
    const content: unknown[] = [];
    if (imgB64) {
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: mediaType, data: imgB64 },
      });
    }
    content.push({ type: 'text', text: desc });

    // ---- (e) call Claude with server-side web search; follow pause_turn.
    const messages: { role: string; content: unknown }[] = [{ role: 'user', content }];
    let data: AnthropicResponse | null = null;
    for (let hop = 0; hop < 4; hop++) {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 1024,
          system: SYSTEM,
          tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
          messages,
        }),
      });
      data = (await resp.json()) as AnthropicResponse;
      if (!resp.ok) return fail(502, data?.error?.message ?? 'AI request failed.');
      if (data.stop_reason === 'pause_turn' && Array.isArray(data.content)) {
        messages.push({ role: 'assistant', content: data.content });
        continue;
      }
      break;
    }

    // ---- (f) extract JSON from the text blocks.
    const text = (data?.content ?? [])
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text as string)
      .join('\n')
      .trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) {
      return fail(502, 'Could not read an estimate from the AI response.');
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text.slice(start, end + 1));
    } catch {
      return fail(502, 'AI returned a malformed estimate.');
    }

    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);
    const best = num(parsed.best);
    const low = num(parsed.low);
    const high = num(parsed.high);
    if (best == null && low == null && high == null) {
      return fail(502, 'AI could not produce a value.');
    }
    const conf = ['low', 'medium', 'high'].includes(parsed.confidence as string)
      ? (parsed.confidence as string)
      : 'low';
    const comparables = Array.isArray(parsed.comparables)
      ? (parsed.comparables as Record<string, unknown>[])
          .slice(0, 3)
          .map((c) => ({
            title: String(c.title ?? '').slice(0, 120),
            price: num(c.price) ?? 0,
            source: String(c.source ?? '').slice(0, 60),
          }))
          .filter((c) => c.title)
      : [];

    return Response.json(
      {
        ok: true,
        estimate: {
          best: best ?? Math.round(((low ?? 0) + (high ?? 0)) / 2),
          low: low ?? best,
          high: high ?? best,
          currency: 'USD',
          confidence: conf,
          rationale: String(parsed.rationale ?? '').slice(0, 300),
          comparables,
          hadPhoto: !!imgB64,
        },
      },
      { headers: cors }
    );
  } catch (e) {
    return fail(500, e instanceof Error ? e.message : String(e));
  }
});
