/**
 * Web document titles.
 *
 * expo-router SDK 57 ships with React Navigation's automatic document-title
 * updater HARD-DISABLED: `expo-router/build/ExpoRoot.js` passes a module-level
 * constant `documentTitle = { enabled: false }` to its NavigationContainer, and
 * nothing in the public API lets an app re-enable it. The result is an empty
 * `<title>` on every route, which leaves screen-reader users with no way to
 * tell pages apart in the tab list / history.
 *
 * So we re-implement the framework's own behaviour on top of the framework's
 * own data: the title still comes from each screen's `title` navigation option
 * (`<Stack.Screen options={{ title }} />` / `<Tabs.Screen options={{ title }} />`),
 * exactly as it would have. We only supply the plumbing that was switched off.
 * Mount `useDocumentTitle()` once, at the root layout.
 */

import { useNavigationContainerRef } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';

/** Brand suffix appended to every page title. */
export const APP_NAME = 'Inventory Our Home';

/**
 * Fallback for routes that declare no `title` option — turns an expo-router
 * route name ("item/[id]", "(parent)", "capture") into something readable.
 */
function titleFromRouteName(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const leaf = name.split('/').pop() ?? name;
  // Drop group markers "(parent)" and dynamic segments "[id]".
  if (/^[([]/.test(leaf)) return undefined;
  const spaced = leaf.replace(/[-_]+/g, ' ').trim();
  if (!spaced) return undefined;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Keeps `document.title` in sync with the focused screen's `title` option.
 * No-op off web.
 */
export function useDocumentTitle() {
  const ref = useNavigationContainerRef();

  useEffect(() => {
    if (Platform.OS !== 'web' || !ref) return;

    const apply = () => {
      const options = ref.getCurrentOptions?.() as { title?: string } | undefined;
      const route = ref.getCurrentRoute?.() as { name?: string } | undefined;
      const title = options?.title ?? titleFromRouteName(route?.name);
      document.title = title ? `${title} · ${APP_NAME}` : APP_NAME;
    };

    apply();

    // 'options' fires when the focused screen's options change; 'state' covers
    // plain navigations between screens that share an options object.
    const unsubOptions = ref.addListener?.('options', apply);
    const unsubState = ref.addListener?.('state', apply);
    return () => {
      unsubOptions?.();
      unsubState?.();
    };
  }, [ref]);
}
