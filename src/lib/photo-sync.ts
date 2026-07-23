/**
 * Photo sync — client side of the photo pipeline.
 *
 * Uploads go through the `upload-photo` Edge Function ONLY (it strips
 * EXIF/GPS server-side and writes with the service role; the private
 * `item-photos` bucket has no client INSERT policy by design). Reads are
 * short-lived signed URLs — the bucket is never public.
 *
 * `localOnly` items never leave the device (same contract as sync.ts).
 */

import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';

import type { Item } from '@/lib/store';

const BUCKET = 'item-photos';
/** Signed-URL lifetime (seconds). */
const SIGNED_URL_TTL = 3600;
/** Re-sign when a cached URL has less than this long left (ms). */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/* ---------------- picking a photo (web file dialog / native library) ------- */

/**
 * Open the platform photo picker and return a local uri, or null if the user
 * cancelled. One place for the options so every "add a photo" flow matches.
 */
export async function pickPhoto(): Promise<string | null> {
  const ImagePicker = await import('expo-image-picker');
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.7,
    allowsMultipleSelection: false,
  });
  if (res.canceled || !res.assets?.length) return null;
  return res.assets[0].uri;
}

/* ---------------- reading the local photo as base64 ---------------- */

export async function readAsBase64(uri: string): Promise<string> {
  if (Platform.OS === 'web') {
    // Web: blob/data URIs from the browser — no filesystem involved.
    const resp = await fetch(uri);
    const blob = await resp.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error ?? new Error('Could not read the photo.'));
      reader.onload = () => {
        const s = String(reader.result);
        resolve(s.slice(s.indexOf(',') + 1)); // strip the data:…;base64, prefix
      };
      reader.readAsDataURL(blob);
    });
  }
  // Native: camera photos are file:// URIs.
  const FileSystem = await import('expo-file-system/legacy');
  return FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
}

/* ---------------- uploads ---------------- */

export interface UploadResult {
  ok: boolean;
  storagePath?: string;
  error?: string;
}

/**
 * Upload one item's local photo through the EXIF-stripping Edge Function and
 * record the resulting storage path on the item.
 */
export async function uploadItemPhoto(item: Item): Promise<UploadResult> {
  if (!item.photoUri) return { ok: false, error: 'No local photo to upload.' };
  if (item.localOnly) return { ok: false, error: 'This item never leaves the device.' };

  const { data: sess } = await supabase.auth.getSession();
  if (!sess?.session) return { ok: false, error: 'Not signed in.' };

  let base64: string;
  try {
    base64 = await readAsBase64(item.photoUri);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not read the photo.' };
  }

  const { data, error } = await supabase.functions.invoke('upload-photo', {
    body: { itemId: item.id, base64 },
  });
  const res = (data ?? null) as { ok?: boolean; storagePath?: string; error?: string } | null;
  if (error || !res?.ok || !res.storagePath) {
    return { ok: false, error: res?.error ?? error?.message ?? 'Upload failed.' };
  }

  useStore.getState().updateItem(item.id, { remotePhotoPath: res.storagePath });
  return { ok: true, storagePath: res.storagePath };
}

/**
 * Upload every item photo that hasn't reached the cloud yet — sequentially,
 * on purpose: dribbling one photo at a time is kind to the backend and to the
 * user's uplink (see the market-wide ops cautions this project inherits).
 */
export async function uploadPendingPhotos(): Promise<{ uploaded: number; failed: number }> {
  const { data: sess } = await supabase.auth.getSession();
  if (!sess?.session) return { uploaded: 0, failed: 0 };

  const pending = useStore
    .getState()
    .items.filter((i) => i.photoUri && !i.remotePhotoPath && !i.localOnly);

  let uploaded = 0;
  let failed = 0;
  for (const item of pending) {
    const res = await uploadItemPhoto(item);
    if (res.ok) uploaded += 1;
    else failed += 1;
  }
  return { uploaded, failed };
}

/* ---------------- signed-URL reads ---------------- */

const urlCache = new Map<string, { url: string; expiresAt: number }>();

/**
 * Signed URL for a storage path in the private bucket, cached in memory and
 * re-signed when it has under five minutes to live. Null when signing fails
 * (not signed in, no household membership, or offline).
 */
export async function getPhotoUrl(path: string): Promise<string | null> {
  const hit = urlCache.get(path);
  if (hit && hit.expiresAt - Date.now() > REFRESH_MARGIN_MS) return hit.url;

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL);
  if (error || !data?.signedUrl) return hit?.url ?? null;

  urlCache.set(path, { url: data.signedUrl, expiresAt: Date.now() + SIGNED_URL_TTL * 1000 });
  return data.signedUrl;
}

/**
 * Resolve a remote storage path to a displayable signed URL.
 * Null while loading, when `path` is absent, or when signing fails.
 */
export function useSignedPhotoUrl(path?: string): string | null {
  const [state, setState] = useState<{ path?: string; url: string | null }>({
    path,
    url: null,
  });

  // Reset when the path changes — the documented render-time state adjustment
  // (not an effect), so a stale photo never flashes while the new one signs.
  if (state.path !== path) setState({ path, url: null });

  useEffect(() => {
    if (!path) return;
    let alive = true;
    getPhotoUrl(path).then((u) => {
      if (alive) setState((s) => (s.path === path ? { path, url: u } : s));
    });
    return () => {
      alive = false;
    };
  }, [path]);

  return state.path === path ? state.url : null;
}
