# Declutter — thread tracker

Running tally of Claude Code sessions in this folder (`C:\Users\kavit\declutter`).
Statuses: 🟢 Running · ⚪ Idle (not running) · ✅ Done/merged · 🔴 Blocked

_Last updated: Sep 8, 2026_

| # | Thread | Status | Last activity | Latest work |
|---|--------|--------|---------------|-------------|
| 1 | Menu visibility on iPhone with bottom menu | ✅ Shipped | Sep 7, 11:00 PM | Family tab "+" / per-family cards (068a166) — verified live |
| 2 | Mobile site logout | ✅ Retired | Sep 8 | Account tab on both mobile bars → Log out reachable anywhere (55b4e32); Heirs to the Keepsakes pill; desktop unchanged. Deployed, verified in-browser, nothing to carry forward. |
| 3 | Default decider, sync e2e & presence banner | ✅ Retired | Sep 8 | Default decider per household + presence banner + e2e scripts (ffd9583); `decided_by_name` (migration 0009), nightly digest via pg_cron + Vault (0010), photo upload waits for the item row (the upload-photo 404 cause), email ping only after a successful push (6cb81cb); free sync / Pro = AI (7c08b4e); header Account pill removed (5bc182e); desktop sign-in loop fix (88717b8). Nothing uncommitted. |
| 4 | Household inventory app (main) | ✅ Retired | Sep 8 | Retired after verifying everything shipped. Landing page + Welcome front door, AI valuation & group-photo split, cross-device item sync (add/edit/delete/archive), the wrong-household write fix, and the pricing doc. One item handed back: re-run the Stripe probe (below) |
| 5 | Collections family grouping | ✅ Retired | Sep 8 | Retired with everything shipped AND deployed (bundle verified). Collections end-to-end (app, spec §Collections, mockup, e2e 23/23 vs prod incl. realtime both ways); household rename/remove/delete-everywhere; migrations `0011` (collections) + `0012` (household delete un-blocked) applied; refresh sync on every load (8b72d3b); "Your backup is waiting — Load it" prompt (68aa6ff); sticky no-photo capture. New tools: `e2e-collections.mjs` (SERVICE_KEY or preset-credential mode) |

| 6 | Family admin controls and custom rooms | ✅ Shipped | Sep 8, 2:45 PM | Custom rooms (floor + location note, name-keyed, rename-aware) and household administrators (`2aa08a7`; migration `0013` applied). Then the photo-retry production fix (`80d380e`): uploads that never reached the family now catch up on connect. Nothing uncommitted. |

| 7 | Sign-in flow for existing house members | ✅ Shipped | Sep 8, 2:30 PM | Invite decline from sign-in + Account & sync (`5a151b1`; migration `0015` applied; `notify-invite-declined` deployed). Resend domain verified; all notification mail sends as `hello@inventoryourhouse.com` (`ef57244`; functions redeployed v6/v2/v7). Nothing uncommitted. |

Summary: 7 threads — 0 running, 3 idle (1, 6, 7), 4 retired and archived. **Everything is committed, pushed, and the schema matches `main`:** thread 6 → `2aa08a7`, thread 7 → `5a151b1` (committed by this session on the user's instruction, by explicit path, each typechecked in isolation); migrations `0013`–`0015` applied; `notify-invite-declined` deployed with JWT verification on. Working tree clean. **Live:** bundle `908901dc…` (verified to carry rooms, admins, invite decline, and heir sync) — every session's work for Sep 8 is deployed.

> Handed over by thread 6, pre-existing: **`addHousehold` doesn't clear `items`/`collections`/`rooms`** the way `removeHousehold` and `startFresh` do, so a newly added home shows the previous home's contents until CloudBridge replaces them. Unowned; on the engineering list. Everything committed, pushed and live; the restore prompt was confirmed in the deployed bundle (`entry-d6e386c…`) before retiring (Sep 8, afternoon).

> ⚠️ Incident, resolved: commit `375797a` (the `completeOnboarding` fix) accidentally swept ~150 lines of thread 5's uncommitted `store.ts` work along with it, leaving `main` type-broken for four minutes. Thread 5 resolved it by committing the rest of the feature (`8910ac7`). Root cause is the standing cross-cutting risk below — multiple sessions editing the same files. **Rule going forward: `git add -p` or a diff check before any commit touching `store.ts`, `sync.ts`, or `realtime.ts`.**

> ✅ Resolved: as of Sep 7 cloud backup/sharing/multi-home are **free**; Pro = the AI layer only (value estimates + photo splitting). `docs/GO-LIVE.md` reconciled to match `docs/PRICING.md`, and `ANTHROPIC_API_KEY` is confirmed set (no longer a blocker).

## What needs to be dealt with

### 🔴 Urgent (runtime / data)
- [x] ~~Confirm Amplify build for 28bbfce (reconcile-on-connect) is **live**~~ — **confirmed Sep 8.** The deployed bundle carries a string from 7606910, the newest code commit at the time, so every commit through it is out. Phone captures reach the cloud now.
- [ ] **Re-run the Stripe probe.** Probed Sep 7: `STRIPE_SECRET_KEY` held the literal placeholder `sk_test_...`, so `create-checkout` returned `500 Invalid API Key` — nobody could subscribe. A real **test** key was set afterwards but never re-verified. Confirm with `$env:SERVICE_KEY="<service_role>"; node tools/probe-checkout.mjs` — want `status: 200` and a `checkout.stripe.com` URL. `docs/PRICING.md` still records the failing state until this passes.
- [x] ~~Duplicate "Millrun" households~~ — **superseded by a full wipe, run Sep 8 ~11:20.** Verified: 0 households, 0 items, 0 members; 4 auth users remain (you + the 3 relatives). The 7 July test households and 11 throwaway users went with it.

### Post-wipe sequence (phone, after the `8b72d3b` build is live)
> **Mostly done, Sep 8 (verified in DB by threads 5 and this one):** the phone backed up a fresh **Millrun** (`e1462b4f`; 1 item, "Painting of Greece", in the Paintings collection), the desktop restored it, and auto-sync is confirmed. **1 of 3 invites is out** (cloud shows one pending). Remaining: the other two invites (step 4) and the second painting (step 5).
1. **Do not tap "Back up now" on the old local Millrun.** Its record still says it was backed up (`cloudLinkedAt`), and the cloud copy is gone — so the guard refuses and points at Restore, and Restore finds nothing. That's the guard working, not a bug.
2. **Settings → Start my real household** (or add a new household): name it Millrun. A fresh record has no link, so its first backup creates the cloud household cleanly.
3. **Back up now.** This is the moment the cloud gets its first household again; every other device syncs from here.
4. **Re-invite** Jesvina, Joseph, dmistry2 (their accounts still exist; a normal invite).
5. Re-photograph the two paintings. Then the refresh sync (`8b72d3b`) means they appear on the laptop on its next load — no Restore needed.

### ✅ Commit decisions (done)
- [x] Thread 2 — Mobile logout committed as **55b4e32** and pushed.
- [x] Thread 3 — Default decider + presence committed as **ffd9583** and pushed.
- [x] Noise left uncommitted: `supabase/.temp/cli-latest`, `.claude/launch.json`, `THREADS.md`.

### 🟡 Follow-ups (not blocking)
- [ ] Run the two-user e2e script: `SERVICE_KEY=<key> node tools/e2e-sync-live.mjs` — **caveat from thread 3:** it was written against pre-Collections / pre-`cloudLinkedAt` row shapes and has never been executed. Check its row builders and subscription shapes against current `sync.ts` before trusting a run. (`tools/e2e-collections.mjs` has a preset-credential mode that needs no SERVICE_KEY if users are minted via SQL.)
- [ ] Presence banner: only the transport was verified (two Node clients). See it with two real signed-in devices — do it in the same session as the signed-in collection-decide run.
- [x] ~~`tools/cleanup-orphans.sql`~~ — deleted Sep 8: obsolete after the wipe; every id in it was gone, and running it against the fresh Millrun would have been a mistake waiting to happen.
- [x] ~~"Daily summary" setting is dead~~ — **wrong, verified live Sep 8:** migration `20260908000010` applied, `cron.job` `daily-digest` active at `0 23 * * *`, function deployed with `verify_jwt: false`. Keep it deployed `--no-verify-jwt`.
- [x] ~~Clear 5 leftover July test households + orphan Millrun.~~ — gone in the Sep 8 wipe.
- [x] ~~Cosmetic: realtime decisions arrive nameless~~ — done in 6cb81cb (`items.decided_by_name`, migration 0009 applied). Chat realtime's missing household filter remains: engineering #8.
- [ ] FYI (no action): daily digest fires **23:00 UTC** fixed (7pm EDT / 6pm EST); Resend sandbox sender delivers only to the owner's address until the domain is verified.
- [ ] FYI (informational, from Supabase advisors): `accept_invite` / `my_pending_invites` are SECURITY DEFINER callable by `authenticated` — intentional; leaked-password protection is off; one MFA factor enabled. Review before launch, not blocking.

### 📸 Photo-retry fix (thread 6, `80d380e`, Sep 8 afternoon) + what it surfaced
- [x] **Photos silently never reached the family.** `item_photos` had zero rows; the only two files in storage sat under the deleted `942f5389` household. Two faults: the upload sweep ran only behind the manual Back up button (a capture-time upload that lost the race with its own item row 404'd and was never retried), and a stale `remotePhotoPath` into a deleted household disqualified an item forever. Fixed: paths whose household segment isn't the linked one count as no path; the sweep runs on connect after reconcile + pull; idempotent.
- [ ] **A whole class of bug, named:** the device that wrote something renders it from local state and *cannot tell* the mirror failed — photos here; **heirs and main decider (this session's sync) have the same shape** since `syncHeirAssignments` is deliberately best-effort and silent. Follow-up: a "not yet shared" indicator or a retry on connect for existing items (today only a full backup re-pushes heirs on items reconcile already knew).
- [ ] **Orphaned storage bytes:** two objects under `942f5389` are unreachable but billed; `item_photos` cascades on household delete, storage does not. Needs (a) a one-off delete of the two, (b) a cleanup path on household delete. Not authorised; user's call.

### 📦 Thread 4 handback (Sep 8, retiring) — verified in repo where marked ✓
- [ ] **The paid product has never been exercised end to end.** No one has run a real AI value estimate or group-photo split against the live key with a Pro household — does it return sensible values, does the vision prompt over/under-split a shelf? This is the whole thing Pro sells. One manual pass: `SERVICE_KEY=… node tools/make-household-pro.mjs "Millrun"`, try both features, then `--free` to revert. **Launch blocker in substance** (GO-LIVE §5 smoke test covers it — do it).
- [x] ~~Per-item main decider does not sync~~ / ~~Heir assignments do not sync~~ — **client shipped Sep 8 (`edf5146`); migration `0014` written, NOT yet applied.** Heirs are their own rows (`heir_assignments`: owner-only writes; members read only `revealed`; `after_death` hidden until the Phase-3 unlock; audited; realtime-filtered by RLS per device). `main_decider_name` on `items`, owner-gated by an additive trigger. **`0014` applied Sep 8** — verified: table + RLS + guard/audit triggers + `items.main_decider_name` + owner-only trigger + realtime publication all present. Heirs and main decider now sync end to end once the `edf5146` build is live.
- [ ] ✓ **`landing/index.html` is dead weight** — a bespoke marketing page (4 generated photos, own `serve.mjs`) that the `expo export web` build never includes; not referenced by `app.json` or `amplify.yml`. The in-app Welcome screen is what actually ships. **Decide:** wire it up as the public front door, or delete it so nobody assumes it's live.
- [ ] ✓ `estimate-value` uses `web_search_20250305` ([index.ts:165](supabase/functions/estimate-value/index.ts)). Thread 4 says `claude-sonnet-5` supports a newer `web_search_20260209` with dynamic filtering (better accuracy, fewer tokens per estimate) — **verify against current Anthropic docs before changing**; cheap upgrade to the paid feature's cost and quality if so.
- [ ] Reminder (already GO-LIVE §1 #4): any household hand-granted Pro via `make-household-pro.mjs` must be reverted with `--free` before launch; Stripe is still on a test key.

### 🔍 E2E + static audit findings (Sep 8) — not yet fixed unless ticked
Live-site pass on desktop and mobile (demo role), plus a read-only code audit. Everything below was verified in code, not assumed.

**Bugs**
- [ ] **React #418 hydration mismatch ×4 per load, desktop and mobile, pre-existing.** `web.output: "static"` pre-renders, but `useIsDesktop()` reads live width and the store hydrates client-side. React recovers, so nothing looks broken, but every load throws in prod and discards the pre-render. Fix = gate layout on a `mounted` flag, or switch to `web.output: "single"` (product call — changes deep-link serving).
- [x] ~~`completeOnboarding` never clears `cloudHouseholdId`~~ — **fixed, shipped Sep 8.** Onboarding now drops the old link like `startFresh`/`addHousehold`, so a fresh home can't write into a prior cloud household or trip the missing-household guard after a wipe.
- [x] ~~**The backup guard has a gap:** `switchHousehold`/`addHousehold`/`startFresh` clear `cloudHouseholdId`, destroying the "was linked, now gone" evidence~~ — **obsolete Sep 8.** The v5→v6 persist migration moved the link onto the household record (`Household.cloudLinkedAt`) and `linkedCloudId` derives from the open household, so there is no top-level id left to clear: the evidence now survives switching and `pushHousehold`'s guard reads it. Verified — no `cloudHouseholdId: undefined` writes remain in `store.ts`.
- [x] ~~`pullHousehold()` with no id picks the *oldest* household~~ — **fixed Sep 8.** `pickMyHousehold()`: one home → load; several → prefer the one open on this device if the account belongs to it, else **ask** (pickers on sign-in and Restore). `pullHousehold()` no longer guesses. Millrun recovery is no longer order-sensitive.
- [x] ~~`restoreSnapshot` replaces `households` with a single element~~ — **fixed Sep 8.** The restored home is merged (replace-or-append, keeping original `createdAt`/link time); other homes stay; only the demo is dropped. The Account & sync promise is now true.
- [x] ~~`signOut`/`resetAll` doesn't clear `cloudHouseholdId`~~ — closed by #1 (no such field; `initial.households` replaces the list, links included). `lastAccountEmail` still survives a reset — harmless (it only drives the sign-in gate), noted.
- [ ] `login.tsx` `finish()` error path shows the sign-in form to an already-signed-in user with no retry — dead end.
- [ ] `item_messages` realtime has no household filter (table lacks `household_id`); client drops unknown items, silently losing messages for items not yet pulled.
- [x] `Btn` had no accessible name — fixed `11025f8`.

**Stale copy (free-sync change not propagated)** — all fixed Sep 8
- [x] Welcome screen: now "free and unlimited everywhere; Pro adds a little AI from $4.99/mo" (verified rendering on a dev server).
- [x] Account & sync: photos are backed up; only voice audio stays local. Header comment too.
- [x] `upgrade.tsx` native: "Start free trial" → "Preview Pro on this device", with an honest note (no native checkout; subscribe on the web). **Finding:** `doNativePreview` just flips the local plan — fine for a preview, but native must not ship with it reachable.
- [x] Settings Pro card: no longer promises App Store / Play / web management.
- [x] `split-photo`: new `needs_backup` reason; capture says "back this home up first" instead of sending a subscriber to the paywall.
- [x] Stale comments in `store.ts`, `ui.tsx`, `limit-banner.tsx`, `upgrade.tsx`.
- [ ] **Support / contact address:** the domain is now verified in Resend (Sep 8, thread 7) and all three email functions send as **`hello@inventoryourhouse.com`** — so that's the address. Still to do: put it in Settings and the Pro card ("get in touch" currently points nowhere). Small.
- [ ] **Resend sender is untested in practice** — DNS verified byte-for-byte, but no mail has gone through `hello@` yet; `dkim=pass` / `dmarc=pass` unconfirmed. Send one to a **non-owner** address (the owner's gmail passed under the old sandbox sender too, so it proves nothing). Your call — it lands in a real inbox.
- [ ] **Auth email is now the likelier launch failure:** sign-in codes and `invite-member` still use Supabase's built-in mailer (a few sends/hour). That's the first email an invited child receives. GO-LIVE polish item 9 (custom SMTP) — promote it.

**Docs behind the code** — fixed Sep 8
- [x] **`HANDOFF.md`** refreshed: status table, repo map, migrations 0008–0012 + 9 functions, pricing, outstanding items, new §13 (everything since July + the multi-session rule). Points at THREADS / GO-LIVE / PRICING as living docs.
- [x] **`AGENTS.md`** rewritten around what's true: brand, Stripe, auth, sync v2, photos, free-sync pricing (with a do-not-regress note), the household-record cloud link, never-guess loading, staging rule, `--no-verify-jwt`, a11y gotcha, hydration issue, remaining phase gate.
- [ ] Privacy row in Settings → "Coming soon"; a privacy policy is typically required for Stripe/app stores.

### 🧹 Simplify pass (Sep 8) — applied vs deferred
Four-angle review (reuse / simplification / efficiency / altitude) of every commit since `28bbfce`. Applied and shipped, behavior-preserving, net −16 lines:
- [x] `sync.ts`: one `itemRow()` for all three item write paths; reconcile batches collection upserts; `pullHousehold` scopes tags/stories/photos to the household's items (was downloading every home's story bodies); `pushCollectionUpdate` drops an unused `getUser()` round trip.
- [x] `ui.tsx` rail card reuses `linkedCloudId()`; Decide grouping is O(n) not O(n²); three Decide bars get a11y labels; collection grid uses `DECISION_META`; unused `T` import removed (lint now 0 warnings).

Deferred — real, but architecture changes or refactors of another session's fresh feature code, not tonight:
- [x] ~~`cloudHouseholdId` is a boolean wearing a uuid, hand-cleared in 6 places.~~ **Done Sep 8.** `Household.cloudLinkedAt` / `lastBackupAt` live on the record; `linkedCloudId()` derives from the open household; all six clears removed; `markCloudLinked` / `unlinkHousehold` replace `setCloudMeta`; persist v6 migrates old devices. Also closes: the backup-guard gap (guard now keys off `wasBackedUp` from the record) and `signOut`/`resetAll` leaving a stale link.
- [x] ~~`pushItemChange` fans out one-swipe collection decides into N sequential chains~~ — **fixed Sep 8.** `pushItemUpdates` resolves user/role once, batches the collection upsert, runs row UPDATEs concurrently, tags as one delete + one insert (40 coins ≈ 44 requests, 40 in flight together). Kept UPDATE-per-row on purpose — an upsert would resurrect items deleted elsewhere. **Not yet exercised signed-in** — the wipe → re-onboard → collection-decide run is the real test.
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
