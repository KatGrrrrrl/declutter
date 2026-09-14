/**
 * Everything in the house, browsable and searchable. Deciders see it as "All
 * items" with bulk actions and the archived shelf; helpers as "Inventory".
 * The behaviour differences live in components/inventory-view.tsx.
 */

import { InventoryView } from '@/components/inventory-view';

export default function InventoryScreen() {
  return <InventoryView />;
}
