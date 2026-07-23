/**
 * AI value estimate — client side of the `estimate-value` Edge Function.
 *
 * Pro-only. Sends the item (and, for a local-only photo, its bytes) to Claude,
 * which web-searches comparable resale listings and returns a value range.
 * Always an informal estimate — the UI must label it as such, never as an
 * appraisal.
 */

import { readAsBase64 } from '@/lib/photo-sync';
import { supabase } from '@/lib/supabase';

import type { Item } from '@/lib/store';

export interface Comparable {
  title: string;
  price: number;
  source: string;
}

export interface ValueEstimate {
  best: number;
  low: number;
  high: number;
  currency: string;
  confidence: 'low' | 'medium' | 'high';
  rationale: string;
  comparables: Comparable[];
  /** Whether the model actually had a photo to look at. */
  hadPhoto: boolean;
}

export type EstimateReason = 'pro_required' | 'not_configured' | 'needs_account' | 'error';

export type EstimateResult =
  | { ok: true; estimate: ValueEstimate }
  | { ok: false; reason: EstimateReason; error?: string };

export async function estimateItemValue(item: Item): Promise<EstimateResult> {
  const { data: sess } = await supabase.auth.getSession();
  if (!sess?.session) return { ok: false, reason: 'needs_account' };

  const body: Record<string, unknown> = { itemId: item.id };
  // Local-only or not-yet-uploaded photo: send the bytes so the server can see
  // it (a stored photo the function fetches itself).
  if (!item.remotePhotoPath && item.photoUri) {
    try {
      body.imageBase64 = await readAsBase64(item.photoUri);
      body.imageMediaType = 'image/jpeg';
    } catch {
      // No readable photo — the estimate falls back to the description.
    }
  }

  const { data, error } = await supabase.functions.invoke('estimate-value', { body });

  if (error) {
    // supabase-js hides the JSON body of a non-2xx behind error.context.
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try {
        const j = (await ctx.json()) as { reason?: EstimateReason; error?: string };
        if (j?.reason) return { ok: false, reason: j.reason, error: j.error };
      } catch {
        // fall through
      }
    }
    return { ok: false, reason: 'error', error: error.message };
  }

  const res = data as { ok?: boolean; estimate?: ValueEstimate; reason?: EstimateReason; error?: string } | null;
  if (res?.ok && res.estimate) return { ok: true, estimate: res.estimate };
  return { ok: false, reason: res?.reason ?? 'error', error: res?.error };
}
