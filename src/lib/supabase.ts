/**
 * Supabase client. The URL and publishable key are PUBLIC by design (they ship
 * in every client bundle; row-level security is the actual boundary), so they
 * are committed here rather than juggled through env vars — same model as the
 * anon key in any Supabase app. Secrets (service role, Stripe) live only in
 * Supabase edge-function secrets, never in this repo.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

// Custom auth domain (fronts the Supabase project xkzuoogmcfrxicmoybzp).
// Using our own domain means the Google sign-in screen reads "continue to
// auth.inventoryourhouse.com" instead of the raw project domain.
const SUPABASE_URL = 'https://auth.inventoryourhouse.com';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_jvgjfZky19YKaFVrH29OWw_6srBfiP1';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    // On native, persist the session in AsyncStorage; on web the default
    // (localStorage) is correct and AsyncStorage would be a no-op shim.
    ...(Platform.OS !== 'web' ? { storage: AsyncStorage } : {}),
    // Stable storage key so switching the URL to the custom domain doesn't
    // orphan existing sessions under a different auto-derived key.
    storageKey: 'sb-inventoryourhome-auth',
    autoRefreshToken: true,
    persistSession: true,
    // Web must read the session from the URL after an OAuth (Google) redirect;
    // native uses the OTP flow and never has one.
    detectSessionInUrl: Platform.OS === 'web',
  },
});
