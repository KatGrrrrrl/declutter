/**
 * Group-photo splitting — client side of the `split-photo` Edge Function.
 *
 * One shot of a shelf/tabletop goes up; Claude vision finds the distinct
 * objects and the server returns a cropped JPEG per object (EXIF-free by
 * re-encoding). Each crop is materialized as a local photo uri the normal
 * addItem/upload pipeline understands:
 *   - web:    Blob → object URL (same session-scoped semantics as the picker)
 *   - native: written into the app's document directory as a .jpg file
 *
 * Pro-only, enforced server-side. The photographer approves every proposed
 * item (or "Approve all") before anything is added — nothing is created here.
 */

import { Platform } from 'react-native';

import { readAsBase64 } from '@/lib/photo-sync';
import { supabase } from '@/lib/supabase';
import { useStore } from '@/lib/store';

export interface ProposedItem {
  name: string;
  photoUri: string;
}

export type SplitReason = 'pro_required' | 'not_configured' | 'no_items' | 'needs_account' | 'error';

export type SplitResult =
  | { ok: true; items: ProposedItem[] }
  | { ok: false; reason: SplitReason; error?: string };

async function materialize(base64: string, index: number): Promise<string> {
  if (Platform.OS === 'web') {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
  }
  const FileSystem = await import('expo-file-system/legacy');
  const uri = `${FileSystem.documentDirectory}split-${Date.now()}-${index}.jpg`;
  await FileSystem.writeAsStringAsync(uri, base64, { encoding: 'base64' });
  return uri;
}

export async function splitGroupPhoto(photoUri: string): Promise<SplitResult> {
  const { data: sess } = await supabase.auth.getSession();
  if (!sess?.session) return { ok: false, reason: 'needs_account' };
  const householdId = useStore.getState().cloudHouseholdId;
  // Pro is a property of a cloud household — no cloud household means free.
  if (!householdId) return { ok: false, reason: 'pro_required' };

  let imageBase64: string;
  try {
    imageBase64 = await readAsBase64(photoUri);
  } catch (e) {
    return { ok: false, reason: 'error', error: e instanceof Error ? e.message : 'Could not read the photo.' };
  }

  const { data, error } = await supabase.functions.invoke('split-photo', {
    body: { imageBase64, householdId },
  });

  if (error) {
    // supabase-js hides non-2xx JSON bodies behind error.context.
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try {
        const j = (await ctx.json()) as { reason?: SplitReason; error?: string };
        if (j?.reason) return { ok: false, reason: j.reason, error: j.error };
      } catch {
        // fall through
      }
    }
    return { ok: false, reason: 'error', error: error.message };
  }

  const res = data as { ok?: boolean; items?: { name: string; base64: string }[]; reason?: SplitReason; error?: string } | null;
  if (!res?.ok || !Array.isArray(res.items) || res.items.length === 0) {
    return { ok: false, reason: res?.reason ?? 'error', error: res?.error };
  }

  const items: ProposedItem[] = [];
  for (let i = 0; i < res.items.length; i++) {
    try {
      items.push({ name: res.items[i].name, photoUri: await materialize(res.items[i].base64, i) });
    } catch {
      // Skip a crop that failed to write; the rest still flow through.
    }
  }
  if (items.length === 0) return { ok: false, reason: 'error', error: 'Could not save the cropped photos.' };
  return { ok: true, items };
}
