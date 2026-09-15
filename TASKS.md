# Task list — work handed to other agents

_Running list of additions and changes for later sessions. **This file is the queue**;
`THREADS.md` remains the session tracker and `docs/GO-LIVE.md` the launch checklist —
where they disagree, the linked source doc wins on detail, this file wins on "is it
still open"._

_Started: Sep 15, 2026. Last updated: Sep 15, 2026._

## How to use this file

- **Claim** a task by putting your thread number + date in the Owner column.
- **Close** a task by ticking it and appending the commit sha — do not delete the line,
  so the next session can see what was decided.
- **Add** new work to the bottom of the right section, with a source reference
  (file:line, QA id, or doc §) so nobody has to re-derive it.
- House rules that apply to every task below: stage by **explicit file path** and check
  `git diff --cached --stat` before committing (several sessions share this folder);
  run `npm run lint` and `npx tsc --noEmit` before every commit; run
  `tools/e2e-core/run.mjs` + `tools/sql/authority-behaviour.sql` before shipping any
  change to `src/lib/` or to RLS/triggers.

---

## 1. Launch blockers

| # | Task | Source | Owner |
|---|------|--------|-------|
| 1.1 | **Re-run the Stripe probe.** `STRIPE_SECRET_KEY` once held the literal placeholder `sk_test_...`; a real test key was set afterwards and never verified. `SERVICE_KEY=<service_role> node tools/probe-checkout.mjs` — want `status: 200` and a `checkout.stripe.com` URL. Update `docs/PRICING.md`, which still records the failing state. | THREADS §Urgent, GO-LIVE §0 | — |
| 1.2 | **Exercise the paid product end to end, once.** Nobody has run a real AI value estimate or group-photo split against the live key on a Pro household — that is the entire thing Pro sells. `SERVICE_KEY=… node tools/make-household-pro.mjs "Millrun"`, try both, then `--free`. Judge whether estimates are sensible and whether the vision prompt over/under-splits a shelf. | THREADS §Thread-4 handback, GO-LIVE §5 | — |
| 1.3 | **Revert every hand-granted Pro household** (`make-household-pro.mjs --free "<name>"` for each entry in `docs/PRICING.md` §5) and confirm a free household still gets `pro_required`. Must be done before launch while Stripe is on a test key. | GO-LIVE §1 #4 | — |
| 1.4 | **Stripe live key** (user's action, not an agent's): `npx supabase secrets set STRIPE_SECRET_KEY=sk_live_…`, then probe, then one real refundable purchase, then confirm the auto-created live catalog. | GO-LIVE §0 | user |
| 1.5 | **Custom SMTP.** Sign-in codes and `invite-member` still use Supabase's built-in mailer (a few sends/hour) — that is the *first* email an invited child ever receives, so it is the likeliest launch failure. Promote from polish. | THREADS §Stale copy, GO-LIVE §2 #9 | — |
| 1.6 | **Privacy policy + Settings row.** The Privacy row says "Coming soon" on a live site; Stripe and the app stores generally require a policy. | QA-09-09 B7 | — |

## 2. Truthfulness — the app says things that aren't true

| # | Task | Source | Owner |
|---|------|--------|-------|
| 2.1 | **Remove the fictional executor.** "Rebecca, Family attorney · Designated" is demo content rendering for every real family. | QA-09-09 A2, QA-09-14 | — |
| 2.2 | **Memorandum export is a stub** — Preview and Export PDF both toast "Coming in Phase 2". Either build it or stop advertising it. (`docs/SPEC.md` treats the memorandum as shipped — reconcile.) | QA-09-09 B1 | — |
| 2.3 | **"Cancel anytime" with no cancel path** (`upgrade.tsx:51,67`). Add a cancel route (Stripe billing portal) or change the copy. | QA-09-09 B2 | — |
| 2.4 | **Insurance inventory / Donation tax receipt cards are inert.** | QA-09-09 B3 | — |
| 2.5 | **"Continue with Apple" shown on web** while Apple OAuth is not enabled (awaiting developer enrollment). Hide it until it works. | QA-09-09 B4 | — |
| 2.6 | **Settings says "No password: we send a six-digit code"** while password sign-in is live. | QA-09-09 B5 | — |
| 2.7 | **Voice recordings store the literal transcript** "(Transcription coming soon)". | QA-09-09 B6 | — |
| 2.8 | **Support address is nowhere.** All three email functions now send as `hello@inventoryourhouse.com`; put it in Settings and on the Pro card, where "get in touch" currently points nowhere. Small. | THREADS §Stale copy | — |
| 2.9 | **Empty Decide on a brand-new home reads "All decided. Beautiful."** — wrong for zero items. | QA-09-09 B8 | — |
| 2.10 | **Navigation lies:** "View as helper" from the demo returns to Welcome, not the app (B9); "Back to Export" from Legacy lands on Decide (B10). | QA-09-09 B9, B10 | — |
| 2.11 | **`landing/index.html` is dead weight** — a bespoke marketing page the `expo export web` build never includes, unreferenced by `app.json` and `amplify.yml`. **Decide:** wire it up as the public front door, or delete it. | THREADS §Thread-4 handback | — |

## 3. Correctness / data integrity

| # | Task | Source | Owner |
|---|------|--------|-------|
| 3.1 | **`addHousehold` doesn't clear `items`/`collections`/`rooms`** the way `removeHousehold`/`startFresh` do, so a new home shows the previous home's contents until CloudBridge replaces them. Unowned since thread 6. | THREADS §handover | — |
| 3.2 | **Silent-mirror-failure class of bug.** The device that wrote something renders it from local state and cannot tell the cloud write failed — photos had this (fixed `80d380e`), **heirs and main decider still do** (`syncHeirAssignments` is deliberately best-effort and silent). Wanted: a "not yet shared" indicator, or a retry on connect for existing items. | THREADS §photo-retry | — |
| 3.3 | **`item_messages` has no `household_id`**, so realtime can't filter by household and the client drops messages for items it hasn't pulled — messages silently lost. Needs a migration + client change. | THREADS §simplify, QA-09-09 | — |
| 3.4 | **`login.tsx` `finish()` error path** shows the sign-in form to an already-signed-in user with no retry — a dead end. | THREADS §E2E findings | — |
| 3.5 | **`mergeCloudData` clears every local heir** when the `heir_assignments` fetch fails. | QA-09-09 C4 | — |
| 3.6 | **Case-only room rename** ("study" → "Study") leaves items in a ghost room. | QA-09-09 C5 | — |
| 3.7 | **Helper keeps a stale "revealed" heir** after the owner flips it back to private — a privacy-posture bug, not cosmetic. | QA-09-09 C6 | — |
| 3.8 | **`plan` is device-global** while `household_plans` is per household; the UI can show Pro on the wrong home. (Server-side gating is correct — this is display only.) | QA-09-09 C7 | — |
| 3.9 | **Web photo data-URIs are persisted into `localStorage`** via AsyncStorage — quota blowout waiting to happen. | QA-09-09 C8 | — |
| 3.10 | **Orphaned storage bytes:** two objects under deleted household `942f5389` are unreachable but billed. Needs (a) a one-off delete, (b) a cleanup path on household delete — `item_photos` cascades, storage does not. **Not authorised — user's call.** | THREADS §photo-retry | user |
| 3.11 | **No static review of the new `src/lib`** has been done since the identity-core rebuild (phases 0–6). The behaviour is covered by the core test; the code has not been read. | QA-09-14 | — |
| 3.12 | **Unproven live:** a decline email to a real administrator address; an account switch with two real people's accounts; the presence banner with two real signed-in devices; delivery to a recipient who is not the Resend account owner (and spam placement). | THREADS §7, §follow-ups, GO-LIVE §5 | — |

## 4. Accessibility & readability (parent-facing screens)

| # | Task | Source | Owner |
|---|------|--------|-------|
| 4.1 | **Contrast:** Decide's three action captions are 11 px (E1); `inkFaint` (#A09A90) fails AA wherever it carries real text (E2); `Btn kind="brass"` white-on-#A67C34 is 3.78:1 (E3). Mostly one theme-token change. | QA-09-09 E1–E3 | — |
| 4.2 | **Small targets on parent screens** — Decide's "Add" pill is 33 px tall (E6). | QA-09-09 E6 | — |
| 4.3 | **Mouse-only controls:** "Estimate value" in Keepsakes and the inventory row. | QA-09-09 E4 | — |
| 4.4 | **Unlabeled onboarding controls** (step 1 Back + both role cards; step 2). | QA-09-09 E5 | — |
| 4.5 | **Toggles without `accessibilityState`** — room chips, decider chips. | QA-09-09 E7 | — |
| 4.6 | **Sheets are not dialogs** — `CollectionPicker` has no `role=dialog`. | QA-09-09 E8 | — |
| 4.7 | **Welcome's "Sign in" link is named "Already set up a home?"** — the accessible name doesn't say what it does. | QA-09-09 E9 | — |
| 4.8 | **~60 raw `Pressable`s still lack `accessibilityLabel`.** RN Web renders `Pressable` as a `div`, which takes no name from a `Text` child. Wanted: shared `TapRow`/`IconBtn` in `ui.tsx` **plus a lint rule** — without the rule every new screen reintroduces it. | THREADS §simplify | — |

## 5. Mobile / native (from code review, not yet exercised on device)

| # | Task | Source | Owner |
|---|------|--------|-------|
| 5.1 | Swipe commit relies on Reanimated's `withTiming` callback (D1). | QA-09-09 D1 | — |
| 5.2 | Presence and Restore banners mount outside any SafeAreaView — under the notch (D2). | QA-09-09 D2 | — |
| 5.3 | Camera "name it" card has no `KeyboardAvoidingView` (D3). | QA-09-09 D3 | — |
| 5.4 | Deep link / refresh into `item/[id]`, `collection/[id]`, `settings` (D4); login has no back or cancel (D5); first launch flashes Welcome before hydration (D6). | QA-09-09 D4–D6 | — |
| 5.5 | Camera and recorder files stay in the cache directory — iOS may purge them (D7). | QA-09-09 D7 | — |
| 5.6 | Native capture is camera-only: no "no photo" path, no library picker (D8); hidden-tab screens have no Back (D9). | QA-09-09 D8, D9 | — |
| 5.7 | Raw network errors ("Failed to fetch") reach the user on sign-in (D10); `notify()` is `window.alert` on web — blocking dialogs for "Backed up" (D11). | QA-09-09 D10, D11 | — |
| 5.8 | **`upgrade.tsx` `doNativePreview` just flips the local plan.** Fine as a preview, but native must not ship with it reachable. Gate it before any store submission. | THREADS §Stale copy | — |
| 5.9 | Replace the Expo placeholder app icons; rebrand the Google OAuth client into its own GCP project (it lives in the OurGroupTrips project today); test Google sign-in on `auth.inventoryourhouse.com`. | GO-LIVE §2 #5–#7 | — |

## 6. Engineering debt / cleanups

| # | Task | Source | Owner |
|---|------|--------|-------|
| 6.1 | **React #418 hydration mismatch ×4 per load**, desktop and mobile, pre-existing. `web.output: "static"` pre-renders while `useIsDesktop()` reads live width and the store hydrates client-side. Fix = a `mounted` gate, or `web.output: "single"` — **a product decision, because it changes deep-link serving.** Meanwhile: don't add more render-time viewport or storage reads. | THREADS, QA-09-14 | — |
| 6.2 | **`declutter-web.zip` (2.9 MB) is committed at the repo root.** A build artifact in git history. Confirm nothing references it, then remove it and add it to `.gitignore`. | this session, Sep 15 | — |
| 6.3 | `ensureCollectionUploaded` re-upserts the same collection once per photographed item in a sweep — needs a session memo. | THREADS §simplify | — |
| 6.4 | Derive `CLOUD_ITEM_KEYS` from `RemoteItemFields` so the compiler catches a missing synced column (four hand-kept copies today). | THREADS §simplify | — |
| 6.5 | Duplicates worth one helper each: the new-household form (`family.tsx` / `settings.tsx`), the collection-count selector (4 sites), `joinNames` (banner / Decide), the round icon button (`collection/[id]` / `settings`), Decide's `collectionMeta` IIFE → `useMemo`, the `SwipeCard` element + meta block duplicated per card kind. | THREADS §simplify | — |
| 6.6 | **`tools/e2e-sync-live.mjs` has never been run** and was written against pre-Collections / pre-`cloudLinkedAt` row shapes. Check its row builders and subscription shapes against the current `src/lib` before trusting a run — or delete it in favour of `tools/e2e-core/run.mjs`. | THREADS §follow-ups | — |
| 6.7 | **`estimate-value` uses `web_search_20250305`** ([`supabase/functions/estimate-value/index.ts:165`](supabase/functions/estimate-value/index.ts)). A newer tool version with dynamic filtering may be available — **verify against the current Anthropic docs first**; if real, it is a cheap accuracy/cost win on the paid feature. | THREADS §Thread-4 handback | — |
| 6.8 | **Docs drift is chronic.** `HANDOFF.md`'s repo map and migration list go stale within days (0001–0018 now, 10 functions). Worth a `tools/` script that regenerates the migration/function inventory instead of hand-editing. | QA-09-09 B12 | — |
| 6.9 | **Decide whether multiple agents keep sharing `store.ts` / `outbox.ts` / `realtime.ts`.** One commit already swept another session's half-finished feature into `main` and broke it for four minutes. Either a file-ownership convention or a pre-commit guard. | THREADS §cross-cutting | — |

## 7. Product decisions waiting on the user

| # | Question | Source |
|---|----------|--------|
| 7.1 | `web.output` `static` vs `single` — fixes React #418 but changes deep-link serving (6.1). | QA-09-09 |
| 7.2 | Keep or delete `landing/index.html` (2.11). | THREADS |
| 7.3 | Delete the two orphaned storage objects under household `942f5389` (3.10). | THREADS |
| 7.4 | **No per-household AI usage cap exists.** Pro subsidises free households' storage; a heavy AI user inverts the margin. Not a launch blocker; needs a policy before volume. | GO-LIVE §1 |
| 7.5 | Supabase advisors, review before launch: `accept_invite` / `my_pending_invites` are SECURITY DEFINER callable by `authenticated` (intentional); leaked-password protection is **off**; one MFA factor enabled. | THREADS §follow-ups |

## 8. Post-wipe sequence still outstanding (phone, user)

- [ ] Re-invite the remaining **two of three** family members (one invite is out and pending).
- [ ] Re-photograph the second painting. The refresh sync (`8b72d3b`) means it appears on the laptop on the next load — no Restore needed.
- Full sequence and the "do not tap Back up now on the old local Millrun" warning: `THREADS.md` → *Post-wipe sequence*.

---

## Changelog

- **Sep 15, 2026** — File created. Seeded from `THREADS.md` (§urgent, §follow-ups, §photo-retry, §thread-4 handback, §E2E findings, §simplify, §cross-cutting), `docs/QA-2026-09-09.md` (A–F), `docs/QA-2026-09-14.md`, and `docs/GO-LIVE.md` (§0–§5). Ticked items from those docs were not carried over. New in this pass: 6.2 (committed `declutter-web.zip`), 6.8 (docs-drift tooling). `b.js`, flagged by the Sep 14 QA, is already gone.
