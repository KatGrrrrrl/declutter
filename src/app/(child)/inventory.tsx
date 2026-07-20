/**
 * Helper inventory — the whole household's things. One shared implementation
 * lives in components/inventory-view.tsx; the owner's "All items" tab renders
 * the same component, which varies its own behaviour by role (contributors
 * get the "N of yours waiting" banner and never see heir names unless the
 * owner revealed them; only deciders get bulk actions and the archive shelf).
 */

import { InventoryView } from '@/components/inventory-view';

export default function InventoryScreen() {
  return <InventoryView />;
}
