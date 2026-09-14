/**
 * Route constants for screens that expo-router's *generated* typed-route union
 * doesn't know about yet (`.expo/types/router.d.ts` is only regenerated when a
 * dev server runs, and `/upgrade` is authored separately). Casting here keeps
 * the cast in one place instead of sprinkling it across screens — once the
 * types regenerate these can become plain string literals.
 */

import type { Href } from 'expo-router';

export const SETTINGS_ROUTE = '/settings' as unknown as Href;
export const UPGRADE_ROUTE = '/upgrade' as unknown as Href;

/** The Family screen — one address for everyone since the tab groups merged. */
export const FAMILY_ROUTE = '/family' as unknown as Href;
