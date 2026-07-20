-- =============================================================================
-- DECLUTTER — migration 0005: server-stamped creator on households.
-- Found by tools/e2e-multiplayer.mjs: households_insert_self requires
-- created_by = auth.uid(), but clients insert only {id, name} and the column
-- had no default — so no client could ever create a household. Stamp it
-- server-side; clients keep sending nothing (they couldn't be trusted for it
-- anyway).
-- =============================================================================

alter table public.households
  alter column created_by set default auth.uid();
