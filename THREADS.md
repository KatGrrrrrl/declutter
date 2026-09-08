# Declutter — thread tracker

Running tally of Claude Code sessions in this folder (`C:\Users\kavit\declutter`).
Statuses: 🟢 Running · ⚪ Idle (not running) · ✅ Done/merged · 🔴 Blocked

_Last updated: Sep 7, 2026 (11:20 PM)_

| # | Thread | Status | Last activity | Latest work |
|---|--------|--------|---------------|-------------|
| 1 | Menu visibility on iPhone with bottom menu | ✅ Shipped | Sep 7, 11:00 PM | Family tab "+" / per-family cards (068a166) — verified live |
| 2 | Mobile site logout | ✅ Shipped | Sep 7, 9:01 PM | Account tab → Log out (55b4e32) |
| 3 | Default decider, sync e2e & presence banner | ✅ Shipped | Sep 7, 10:56 PM | Fixed desktop sign-in loop; signing in with no home now loads your household (88717b8) |
| 4 | Household inventory app (main) | ⏳ Awaiting user | Sep 7, 11:15 PM | Walked user through setting the real Stripe **test** key; probe (`tools/probe-checkout.mjs`) not yet confirmed. Also 2078376, 8737944 (pricing doc vs "free-sync" change) |

Summary: 4 threads — 0 running, 4 idle. Everything committed; all pushed except this session's two commits (7606910 guard, 219514b docs).

> ✅ Resolved: as of Sep 7 cloud backup/sharing/multi-home are **free**; Pro = the AI layer only (value estimates + photo splitting). `docs/GO-LIVE.md` reconciled to match `docs/PRICING.md`, and `ANTHROPIC_API_KEY` is confirmed set (no longer a blocker).

## What needs to be dealt with

### 🔴 Urgent (runtime / data)
- [ ] Confirm Amplify build for today's commits (28bbfce reconcile-on-connect) is **live** — items captured on the phone tonight never reached the cloud (upload-photo 404s) until this bundle deploys.
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
- [ ] "Daily summary" setting is dead (no `pg_cron`/scheduler) — hide it or wire a scheduler.
- [ ] Clear 5 leftover July test households + orphan Millrun.
- [ ] Cosmetic: realtime decisions arrive nameless; chat realtime has no household filter.

### ⚠️ Cross-cutting
- [ ] 3–4 sessions edited `store.ts` / `realtime.ts` at once; commit 28bbfce swept ~5 lines of another thread's work in. Decide whether to keep multiple agents in the same files.

## Deploy readiness
- ✅ Code compiles (`tsc` clean) and lints (0 errors, 1 pre-existing warning) with all uncommitted work combined.
- ⚠️ Not "one-commit ready": two unrelated features are interleaved and temp/noise files are present — split before committing.
- ⚠️ Deploying the code won't fix the runtime data issues above (Amplify build + Millrun cleanup are separate).

_(Tracker excludes the current session, which maintains this file.)_
