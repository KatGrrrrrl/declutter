# Declutter — thread tracker

Running tally of Claude Code sessions in this folder (`C:\Users\kavit\declutter`).
Statuses: 🟢 Running · ⚪ Idle (not running) · ✅ Done/merged · 🔴 Blocked

_Last updated: Sep 8, 2026_

| # | Thread | Status | Last activity | Latest work |
|---|--------|--------|---------------|-------------|
| 1 | Menu visibility on iPhone with bottom menu | ✅ Shipped | Sep 7, 11:00 PM | Family tab "+" / per-family cards (068a166) — verified live |
| 2 | Mobile site logout | ✅ Shipped | Sep 7, 9:01 PM | Account tab → Log out (55b4e32) |
| 3 | Default decider, sync e2e & presence banner | ✅ Shipped | Sep 7, 10:56 PM | Fixed desktop sign-in loop; signing in with no home now loads your household (88717b8) |
| 4 | Household inventory app (main) | ✅ Retired | Sep 8 | Retired after verifying everything shipped. Landing page + Welcome front door, AI valuation & group-photo split, cross-device item sync (add/edit/delete/archive), the wrong-household write fix, and the pricing doc. One item handed back: re-run the Stripe probe (below) |
| 5 | Collections family grouping | ✅ Shipped | Sep 8, 12:32 AM | Named item sets with en-masse capture and one-swipe deciding (8910ac7); migration `20260908000011` applied |

Summary: 5 threads — 1 running (Collections), 3 idle, 1 retired. Everything committed and pushed; `main` is level with origin and typechecks in isolation (verified Sep 8, 12:35 AM).

> ⚠️ Incident, resolved: commit `375797a` (the `completeOnboarding` fix) accidentally swept ~150 lines of thread 5's uncommitted `store.ts` work along with it, leaving `main` type-broken for four minutes. Thread 5 resolved it by committing the rest of the feature (`8910ac7`). Root cause is the standing cross-cutting risk below — multiple sessions editing the same files. **Rule going forward: `git add -p` or a diff check before any commit touching `store.ts`, `sync.ts`, or `realtime.ts`.**

> ✅ Resolved: as of Sep 7 cloud backup/sharing/multi-home are **free**; Pro = the AI layer only (value estimates + photo splitting). `docs/GO-LIVE.md` reconciled to match `docs/PRICING.md`, and `ANTHROPIC_API_KEY` is confirmed set (no longer a blocker).

## What needs to be dealt with

### 🔴 Urgent (runtime / data)
- [x] ~~Confirm Amplify build for 28bbfce (reconcile-on-connect) is **live**~~ — **confirmed Sep 8.** The deployed bundle carries a string from 7606910, the newest code commit at the time, so every commit through it is out. Phone captures reach the cloud now.
- [ ] **Re-run the Stripe probe.** Probed Sep 7: `STRIPE_SECRET_KEY` held the literal placeholder `sk_test_...`, so `create-checkout` returned `500 Invalid API Key` — nobody could subscribe. A real **test** key was set afterwards but never re-verified. Confirm with `$env:SERVICE_KEY="<service_role>"; node tools/probe-checkout.mjs` — want `status: 200` and a `checkout.stripe.com` URL. `docs/PRICING.md` still records the failing state until this passes.
- [ ] **Duplicate "Millrun" households** — corrected picture: the July one (`942f5389`) has the 3 invites but 0 items; the one created tonight (`8974781a`) has your 2 paintings but no invites. This is a **merge, not a delete** (see recovery sequence below).

### Millrun recovery sequence (do in this exact order)
1. **Merge** the 2 items into the invited household, then **delete** the duplicate (SQL blocked by the harness classifier — run in Supabase SQL editor):
   ```sql
   begin;
   update items set household_id='942f5389-85e2-492d-927d-b0b43fdcea14'
     where household_id='8974781a-8c9a-4904-8ac3-95af8c92ea82';
   delete from households where id='8974781a-8c9a-4904-8ac3-95af8c92ea82';
   commit;
   ```
2. On the phone: **Settings → Account & sync → "Restore from my backup."** After the delete, `942f5389` is your only cloud household, so restore pulls it and repoints the device (`activeHouseholdId = cloudHouseholdId = 942f5389`). Your 2 paintings come back stamped as yours.
3. ⚠️ **Do NOT tap "Back up now" before step 2.** While the phone is still on local `8974781a`, a backup would recreate the deleted household and re-push the items — resurrecting the duplicate. (The backup guard drafted in `sync.ts` now blocks this, but restore-first is still the rule.)
4. Verify one Millrun remains with 2 items + 4 members:
   ```sql
   select id, name,
     (select count(*) from items i where i.household_id=h.id) as items,
     (select count(*) from household_members m where m.household_id=h.id) as members
   from households h where h.name ilike '%millrun%';
   ```

### ✅ Commit decisions (done)
- [x] Thread 2 — Mobile logout committed as **55b4e32** and pushed.
- [x] Thread 3 — Default decider + presence committed as **ffd9583** and pushed.
- [x] Noise left uncommitted: `supabase/.temp/cli-latest`, `.claude/launch.json`, `THREADS.md`.

### 🟡 Follow-ups (not blocking)
- [ ] Run the two-user e2e script: `SERVICE_KEY=<key> node tools/e2e-sync-live.mjs`
- [x] ~~"Daily summary" setting is dead~~ — **wrong, verified live Sep 8:** migration `20260908000010` applied, `cron.job` `daily-digest` active at `0 23 * * *`, function deployed with `verify_jwt: false`. Keep it deployed `--no-verify-jwt`.
- [ ] Clear 5 leftover July test households + orphan Millrun.
- [ ] Cosmetic: realtime decisions arrive nameless; chat realtime has no household filter.

### 🔍 E2E + static audit findings (Sep 8) — not yet fixed unless ticked
Live-site pass on desktop and mobile (demo role), plus a read-only code audit. Everything below was verified in code, not assumed.

**Bugs**
- [ ] **React #418 hydration mismatch ×4 per load, desktop and mobile, pre-existing.** `web.output: "static"` pre-renders, but `useIsDesktop()` reads live width and the store hydrates client-side. React recovers, so nothing looks broken, but every load throws in prod and discards the pre-render. Fix = gate layout on a `mounted` flag, or switch to `web.output: "single"` (product call — changes deep-link serving).
- [x] ~~`completeOnboarding` never clears `cloudHouseholdId`~~ — **fixed, shipped Sep 8.** Onboarding now drops the old link like `startFresh`/`addHousehold`, so a fresh home can't write into a prior cloud household or trip the missing-household guard after a wipe.
- [ ] **The new backup guard has a gap:** `switchHousehold`/`addHousehold`/`startFresh` clear `cloudHouseholdId`, destroying the "was linked, now gone" evidence, so `pushHousehold` can still re-insert a deleted household. Needs a persisted breadcrumb of known cloud ids.
- [ ] **`pullHousehold()` with no id picks the *oldest* household** (`order created_at limit 1`). Multi-home is free now, so Restore / sign-in-with-no-home can land in the wrong home. This also affects the Millrun recovery: with two Millruns, Restore picks the **July** one — which is the correct target *after* the merge, but only because the duplicate gets deleted first. Keep that order.
- [ ] **`restoreSnapshot` replaces `households` with a single element** — wipes every other local home, reachable via `acceptInvite`, beside copy promising "your own data stays untouched."
- [ ] `signOut`/`resetAll` `set({...initial})` doesn't clear `cloudHouseholdId`/`lastAccountEmail` (initial lacks the keys; zustand merges). Masked by `isDemo` today.
- [ ] `login.tsx` `finish()` error path shows the sign-in form to an already-signed-in user with no retry — dead end.
- [ ] `item_messages` realtime has no household filter (table lacks `household_id`); client drops unknown items, silently losing messages for items not yet pulled.
- [x] `Btn` had no accessible name — fixed `11025f8`.

**Stale copy (free-sync change not propagated)**
- [ ] **`welcome.tsx:98-99` — the first screen still says backup and sharing are "from $39 a year."** Launch-visible.
- [ ] `account-sync.tsx:279-281` says photos aren't backed up — they are (`uploadPendingPhotos` runs on every backup). Only voice audio isn't.
- [ ] `upgrade.tsx` native CTA says "Start free trial" / "after your trial" — there is no trial in `create-checkout`.
- [ ] `settings.tsx:466-469` promises "manage your subscription in the App Store / Play / web" — no billing portal exists.
- [ ] `split-photo.ts:49-50` tells a Pro user with a cleared cloud link "A Pro feature" instead of "back up first."
- [ ] Stale comments: `store.ts:142-150` (paywall at cloud), `ui.tsx:218` ("paid"), `limit-banner.tsx:2-4`, `upgrade.tsx:37` ("PLACEHOLDER PRICING"), `store.ts:183` (RevenueCat).

**Docs behind the code**
- [ ] **`HANDOFF.md`** ("read this first") still states the old cloud paywall as shipped (§7), lists `ANTHROPIC_API_KEY` as unset, says 7 migrations / 7 functions (actual 10 / 9), and describes tab layouts that no longer exist.
- [ ] **`AGENTS.md`** is wrong on brand (says Declutter; app is "Inventory Our Home"), auth (says OTP only; password + OTP + Google exist), payments (says RevenueCat later; Stripe is live), photos (says not uploaded; they are), and phase gating (tells agents not to build heirs/memorandum/AI — all shipped). An agent following it would regress the app.
- [ ] Privacy row in Settings → "Coming soon"; a privacy policy is typically required for Stripe/app stores.

### 🧹 Simplify pass (Sep 8) — applied vs deferred
Four-angle review (reuse / simplification / efficiency / altitude) of every commit since `28bbfce`. Applied and shipped, behavior-preserving, net −16 lines:
- [x] `sync.ts`: one `itemRow()` for all three item write paths; reconcile batches collection upserts; `pullHousehold` scopes tags/stories/photos to the household's items (was downloading every home's story bodies); `pushCollectionUpdate` drops an unused `getUser()` round trip.
- [x] `ui.tsx` rail card reuses `linkedCloudId()`; Decide grouping is O(n) not O(n²); three Decide bars get a11y labels; collection grid uses `DECISION_META`; unused `T` import removed (lint now 0 warnings).

Deferred — real, but architecture changes or refactors of another session's fresh feature code, not tonight:
- [x] ~~`cloudHouseholdId` is a boolean wearing a uuid, hand-cleared in 6 places.~~ **Done Sep 8.** `Household.cloudLinkedAt` / `lastBackupAt` live on the record; `linkedCloudId()` derives from the open household; all six clears removed; `markCloudLinked` / `unlinkHousehold` replace `setCloudMeta`; persist v6 migrates old devices. Also closes: the backup-guard gap (guard now keys off `wasBackedUp` from the record) and `signOut`/`resetAll` leaving a stale link.
- [ ] `pushItemChange` fans out one-swipe collection decides into N sequential chains (~7 round trips per item; 40 coins ≈ 280 requests). Batch rows + resolve user/role once.
- [ ] `ensureCollectionUploaded` re-upserts the same collection once per photographed item in a sweep — needs a session memo.
- [ ] Derive `CLOUD_ITEM_KEYS` from `RemoteItemFields` so the compiler catches a missing synced column (four hand-kept copies today).
- [ ] `item_messages` needs a `household_id` column; the client-side filter drops messages for items not yet pulled.
- [ ] ~60 raw `Pressable`s still lack `accessibilityLabel` (8 added tonight). Shared `TapRow`/`IconBtn` in `ui.tsx` + a lint rule — otherwise every new screen reintroduces it.
- [ ] Duplicates worth one helper each: new-household form (`family.tsx` / `settings.tsx`), collection-count selector (4 sites), `joinNames` (banner / Decide), round icon button (`collection/[id]` / `settings`), Decide's `collectionMeta` IIFE → `useMemo`, `SwipeCard` element + meta block duplicated per card kind.

### ⚠️ Cross-cutting
- [ ] 3–4 sessions edited `store.ts` / `realtime.ts` at once; commit 28bbfce swept ~5 lines of another thread's work in. Decide whether to keep multiple agents in the same files.

## Deploy readiness
- ✅ Code compiles (`tsc` clean) and lints (0 errors, 1 pre-existing warning) with all uncommitted work combined.
- ⚠️ Not "one-commit ready": two unrelated features are interleaved and temp/noise files are present — split before committing.
- ⚠️ Deploying the code won't fix the runtime data issues above (Amplify build + Millrun cleanup are separate).

_(Tracker excludes the current session, which maintains this file.)_
