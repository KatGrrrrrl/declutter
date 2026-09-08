/**
 * Legacy free-tier quota UI. The pricing model changed: the inventory is
 * unlimited and free everywhere (only the AI layer is paid), so there is no
 * item cap to meter. These render nothing and remain only so the
 * screens that still import them keep working; new code shouldn't use them.
 */

export function ItemQuotaMeter(_props: { style?: object }) {
  return null;
}

export function LimitReachedCard(_props: { style?: object }) {
  return null;
}
