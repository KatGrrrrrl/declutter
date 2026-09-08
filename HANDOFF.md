# Inventory Our Home — Session Handoff

> **Read this first in any new session.** It's the single source of truth for
> where the project stands. Open the new session with the working directory set
> to **`C:\Users\kavit\declutter`** — this repo is fully self-contained and must
> **not** be mixed with any other project (e.g. StockPulseNow).
>
> _Last updated: 2026-09-08 (sections 2, 4, 5, 7, 8 refreshed; a Sep-8 summary
> is in §13). For anything in flight, three living docs are more current than
> this file: [`THREADS.md`](THREADS.md) (sessions, open bugs, recovery steps),
> [`docs/GO-LIVE.md`](docs/GO-LIVE.md) (launch checklist), and
> [`docs/PRICING.md`](docs/PRICING.md) (what Pro is and costs — source of truth)._

---

## 1. What this is

**Inventory Our Home** — a household estate/legacy app ("Swedish death cleaning,
together"). Children photograph a parent's belongings; the parent decides
**Keep / Donate / Let-go**, records voice stories, privately assigns heirs, and
exports a personal-property memorandum.

- **Brand** (user-facing, in-app, emails, domain): **Inventory Our Home**
- **Repo / folder / scheme / slug** (technical only): **`declutter`**
- **In-app term for kept items:** "Keepsakes"
- **Live at:** https://inventoryourhouse.com (+ www)
- Note the brand/domain mismatch is intentional/known: brand says "Home",
  domain is inventoryour**house**.com.

Prior name history: Trove → Declutter → (Keepsake considered but **not** adopted
as brand). We keep the Keep/Donate/Let-go taxonomy — we did **not** adopt the
"Keepsake" mockup's "Assign-as-a-decision" model.

---

## 2. Status at a glance — it's LIVE

The full app is built, verified, and in production. Web is live on Amplify;
Supabase backend is live; custom auth domain is live; payments are wired but
**blocked on one user action** (see §7).

| Area | State |
|---|---|
| Web app | ✅ Live at inventoryourhouse.com (AWS Amplify auto-deploy from `main`) |
| Backend | ✅ Supabase project `declutter` (`xkzuoogmcfrxicmoybzp`, ca-central-1) |
| Auth | ✅ Email password + OTP + Google OAuth; custom domain live |
| Photos | ✅ Private bucket, EXIF-stripped uploads, signed URLs |
| Pricing | ✅ **Changed 2026-09-07:** backup, sharing, multi-home are **free**; Pro ($4.99/mo · $39/yr) = AI value estimates + photo splitting only |
| Payments | ⚠️ Stripe Checkout live on a **test** key (`sk_test_…`). Real launch needs `sk_live_…` — see GO-LIVE §0. Probe with `node tools/probe-checkout.mjs` |
| AI | ✅ `ANTHROPIC_API_KEY` set 2026-09-07; `estimate-value` and `split-photo` live, Pro-gated server-side |
| Email | ⚠️ Instant delivery works to owner's gmail only until domain verified in Resend. Daily digest **is live** (pg_cron, migration 0010) |
| iOS/Android | ⛔ Not submitted — blocked on Apple Developer enrollment. Native `upgrade.tsx` has a **preview-only** Pro button (no checkout); must not ship reachable |

---

## 3. Tech stack & the gotchas that will bite you

- **Expo SDK 57 + expo-router + TypeScript** (React Native + RN Web). React
  Compiler is **enabled**.
- **Zustand v5** store with `persist` (AsyncStorage), `src/lib/store.ts`.
- **Supabase**: Postgres + RLS + Auth + Edge Functions (Deno) + private Storage.
- **AWS Amplify** auto-deploy from GitHub `main`. DNS on **Route 53**.
- **Stripe Checkout** via edge functions.

### Gotchas (documented in `AGENTS.md`, repeated here because they cost hours)

1. **Zustand object/array selectors MUST use the `useShallow`-wrapped hooks in
   `store.ts`.** Passing a raw object/array selector to `useStore` triggers a
   "getSnapshot should be cached" infinite loop that **blank-screens the web
   build**. This is the #1 way to break the app.
2. **`react-hooks/set-state-in-effect` lint rule** flags synchronous `setState`
   inside `useEffect`. Fix by using **lazy `useState` initializers**, not
   setState-in-effect. (Bit us on login-error and OAuth-error seeding.)
3. **Desktop left rail (`tabBarPosition:'left'`)**: React Navigation defaults the
   sidebar `minWidth` to **25% of the frame**. You MUST pin both `minWidth` and
   `maxWidth` = `SIDEBAR_WIDTH` (232) or it renders ~360px wide.
4. **Active rail pill** uses the active tint as the fill — set
   `tabBarActiveBackgroundColor: T.brassTint` + `tabBarActiveTintColor: T.heading`
   or you get invisible navy-on-navy text.
5. **Titles**: expo-router hard-disables React Navigation's document-title
   updater (`documentTitle:{enabled:false}`) — use the `use-document-title` hook.
6. **RN7 web has no working `unmountOnBlur`/`detachInactiveScreens`** — blurred
   tab screens are hidden via `display:none` + `aria-hidden` instead.
7. **Logout race**: `LockGate` alone navigates on lock. Never add a second
   `router.replace` in a logout handler — it double-mounts and races the
   confirmation notice away. The `pendingLogoutNotice` store flag gates the
   notice (cleared only on dismiss / sign-in).
8. **Responsive**: `useIsDesktop()` = web && width ≥ 900. `DESKTOP_CONTENT_MAX`
   = 1080, `SIDEBAR_WIDTH` = 232.
9. **Stripe prices are immutable** — changing a price needs a **new
   `lookup_key`** (that's why yearly is `declutter_pro_yearly_v2`).

---

## 4. Repo map

```
C:\Users\kavit\declutter\
├─ src/
│  ├─ app/                     # expo-router routes
│  │  ├─ (child)/              # contributor tabs: capture, rooms, inventory, family, account (mobile only)
│  │  ├─ (parent)/             # decider tabs: decide, inventory (Items), keepsakes, export, account (mobile);
│  │  │                        #   heirs is desktop-rail only (mobile reaches it via the Keepsakes pill);
│  │  │                        #   capture + legacy are href:null routes
│  │  ├─ collection/[id].tsx   # a named item set (Collections, 2026-09-08)
│  │  ├─ item/[id].tsx         # role-aware item detail (stories, heirs, chat, donation)
│  │  ├─ login.tsx             # password default; signup; OTP + Google alternates
│  │  ├─ upgrade.tsx           # cloud-backup + family-sharing paywall
│  │  ├─ onboarding*           # set up a home, name decider(s), invite members
│  │  └─ +html.tsx             # web shell (viewport-fit=cover safe-area fix)
│  ├─ components/
│  │  ├─ inventory-view.tsx    # Items list; stat tiles; value column; filters/bulk
│  │  └─ ui.tsx                # NavigationTabBar (rail), Title/Heading, Screen, PhotoBox
│  ├─ hooks/                   # use-document-title, etc.
│  ├─ lib/
│  │  ├─ store.ts              # Zustand store — THE state model + useShallow hooks
│  │  ├─ supabase.ts           # client; URL = https://auth.inventoryourhouse.com
│  │  ├─ photo-sync.ts         # uploadItemPhoto, pickPhoto helper
│  │  ├─ sync.ts              # snapshot backup/restore + v2 upsert merge
│  │  └─ cloud-bridge... / components/cloud-bridge.tsx  # realtime + session gate
│  └─ constants/theme.ts       # T (colors), Fonts, Radius, Spacing
├─ supabase/
│  ├─ migrations/              # 0001..0012 (see §5)
│  └─ functions/               # 9 edge functions (see §5)
├─ docs/SPEC.md, docs/PRICING.md, docs/GO-LIVE.md, docs/SHIPPING.md, docs/mockup/
├─ THREADS.md                  # session tracker: open bugs, recovery sequences, audit findings
├─ tools/                      # e2e + probe scripts, make-household-pro, cleanup-orphans.sql
├─ AGENTS.md                   # gotchas + conventions (keep in sync with this file)
├─ amplify.yml                 # expo export web -> dist
└─ app.json                    # brand name, scheme, permission strings
```

---

## 5. Backend detail

**Supabase project:** `declutter` — id `xkzuoogmcfrxicmoybzp`, region ca-central-1
(same org as StockPulse but a **separate project**). CLI-linked. DB password in
`.dbpassword.local` (gitignored).

**Migrations** (`supabase/migrations/`):
- `0001 phase1_core_loop` — RLS schema via `private.*` SECURITY DEFINER helpers,
  owner-only decision triggers, append-only audit log, no client Storage INSERT.
- `0002 app_evolution` — chat / donation / roster / household_plans.
- `0003 roster_email` — `roster_entries.invited_email`.
- `0004 multiplayer` — realtime publication + `my_pending_invites` RPC.
- `0005 created_by_default` / `0006 invited_by_default` — `auth.uid()` defaults
  (caught by the e2e test — inserts failed without them).
- `0007 notification_prefs` — Off/Instant/Daily prefs.
- `0008 item_archived` — archive is shared cloud state.
- `0009 decided_by_name` — decisions carry the decider's display name.
- `0010 daily_digest_schedule` — installs `pg_cron` + `pg_net`; schedules `daily-digest`
  at 23:00 with a Vault secret. **The function must stay deployed `--no-verify-jwt`.**
- `0011 collections` — named item sets (`collections`, `items.collection_id`).
- `0012 household_delete_cascade` — owner delete-everywhere cascades cleanly.
- `0013 rooms_and_admins` — name-keyed `rooms` (floor + location note); `roster_entries.is_admin`.
- `0014 heir_assignments_main_decider` — heir assignments as RLS-hidden rows (owner-only
  writes; members read only `revealed`); `items.main_decider_name`, owner-gated.
- `0015 invite_decline` — `decline_invite()` RPC, the mirror of `accept_invite()`.

**Edge functions** (`supabase/functions/`, deploy: `supabase functions deploy <name>`):
- `notify-invite-declined` — emails a household's administrators when an invitee says no
  (JWT verification **on**; gated on the caller's own `declined_at` row).
- `create-checkout`, `verify-checkout`, `stripe-webhook` — Stripe (v1 verifies on
  return; no webhook registration needed). Prices are found-or-created by lookup key.
- `upload-photo` — decode/re-encode strips EXIF, 1600px cap, private bucket + signed URLs.
- `estimate-value`, `split-photo` — the AI layer (Claude); **Pro-gated server-side** on
  `household_plans.plan = 'pro'`. Need `ANTHROPIC_API_KEY` (set).
- `invite-member` — Supabase admin invite email on approval.
- `notify-item-added`, `daily-digest` — email notifications (`daily-digest` is
  called by cron with no Authorization header → deploy with `--no-verify-jwt`).

**Ids:** UUIDs unify local/cloud (persist v4 remap). **Sync v2** = upsert merge —
owners push all items; contributors push only their own undecided items.

**Custom auth domain (live):** `auth.inventoryourhouse.com` fronts Supabase
(CNAME → `xkzuoogmcfrxicmoybzp.supabase.co` + 2 verification TXT records in
Route 53; `supabase domains create/reverify/activate`). `supabase.ts` uses it
with `storageKey: 'sb-inventoryourhome-auth'`. Google OAuth callback
`https://auth.inventoryourhouse.com/auth/v1/callback` is registered. Paid Supabase
add-on (~$10/mo). Google client "Declutter Web" currently lives in the
**OurGroupTrips GCP project** — rebrand to its own Declutter GCP project pre-launch.

---

## 6. Deployment & DNS

- **Web:** GitHub `KatGrrrrrl/declutter` (`main`) → AWS Amplify auto-build
  (`amplify.yml`: expo export web → `dist`). Amplify app `d3mbyx420tjxzh`.
  Builds are **slow (10–30+ min)** but reliable.
- **DNS:** Route 53 hosted zone (nameservers moved off external registrar to AWS:
  ns-341.awsdns-42.com / ns-704 / ns-1200 / ns-1690). Apex → Amplify.
- Deep links to dynamic routes return HTTP 404 status but serve
  `+not-found.html` = full app shell, so they render correctly in browsers.
- **Deploy = push to `main`.** Watch the bundle hash change on the live site to
  confirm (entry-*.js filename changes).

---

## 7. Pricing & what blocks a paid launch

**Pricing model (changed 2026-09-07, source of truth `docs/PRICING.md`):** the
inventory is free and **unlimited everywhere** — on the device, backed up, and
shared across the family, any number of homes. The **only** paid layer is AI:
value estimates (`estimate-value`) and group-photo splitting (`split-photo`),
gated server-side. Monthly **$4.99** (`declutter_pro_monthly`, 499), yearly
**$39** (`declutter_pro_yearly_v2`, 3900). Local limits in `store.ts` are
`Infinity`. Note the cost story inverted: Supabase now carries every household
while only AI users pay (PRICING.md has the margin note).

**⚠️ Stripe is on a TEST key.** `STRIPE_SECRET_KEY` was once the literal
placeholder `sk_test_...`; a real *test* key was set on Sep 7 but re-verify with
`node tools/probe-checkout.mjs`. A real launch needs `sk_live_…` — the first
live checkout auto-creates the live prices by lookup key; verify it in the
dashboard. Full sequence in `docs/GO-LIVE.md` §0.

---

## 8. Outstanding / user-action items

| # | Item | Owner | Notes |
|---|---|---|---|
| 0 | ~~Set `ANTHROPIC_API_KEY`~~ | done | Set 2026-09-07; both AI functions live. |
| 1 | Set **live** `STRIPE_SECRET_KEY` (currently a test key) | **user** | Blocks real payments. `tools/probe-checkout.mjs` verifies; GO-LIVE §0. |
| 2 | Verify `inventoryourhouse.com` in **Resend** (DNS) | **user** | Until then, instant emails deliver **only to owner's gmail**. |
| 3 | ~~Set `DIGEST_SECRET` + a scheduler~~ | done | Migration 0010 schedules it via pg_cron with a Vault secret; `DIGEST_SECRET` is an optional override. Keep `daily-digest` deployed `--no-verify-jwt`. |
| 3b | Add a **support / contact address** to the app | **user** | None exists anywhere; the Pro card says "get in touch" with nowhere to go. |
| 4 | Test Google sign-in on custom domain | user | Should read "continue to auth.inventoryourhouse.com". |
| 5 | Rebrand Google OAuth client to own Declutter GCP project | pre-launch | Currently in OurGroupTrips project. |
| 6 | Apple Developer enrollment | user | Blocks iOS submission (Apple sign-in + store). |
| 7 | Replace Expo placeholder app icons | pre-launch | Still default Expo icons. |
| 8 | Custom SMTP (built-in mailer = few emails/hr) | pre-launch | Resend covers most of this. |

**Test scripts** (`tools/`): `e2e-multiplayer.mjs` (18/18 two-user live-backend
test; run `SERVICE_KEY=<service role> node tools/e2e-multiplayer.mjs`),
`e2e-email-stripe.mjs`, `probe-checkout.mjs`.

---

## 9. Most recent work (this session, all LIVE)

Shipped, in order:
1. Reprice to free-unlimited-local + cloud paywall + $39/yr.
2. Custom auth domain `auth.inventoryourhouse.com` end-to-end.
3. Invite bug fix ("Awaiting Jesvina" on every invite → organizer/creator can
   approve; `canManageMembers = canDecide || userName === createdBy`).
4. Prominent login error banner (was muted grey at the bottom).
5. Desktop nav rail: Log out added; account/settings moved to bottom.
6. Require sign-in for account-bound households (CloudBridge session gate).
7. **Keepsake-mockup incorporation** (commit `74c886e`) — the last change:
   - **Stat tiles** atop Inventory: Items · To decide · Kept · Documented value.
     4-across desktop, 2×2 mobile. "To decide" is a live filter toggle. Value is
     **decider-only** — contributors get a "Rooms" tile instead (no value leak).
   - **Value shown in every row** for deciders (was only when sorting by value).
   - **"Protected & backed up" status card** in the desktop rail (Pro shows a
     relative timestamp; free shows an "On this device · add cloud backup" nudge).

8. **Parents can catalogue their own things** — a decider now has an "Add item"
   entry on the Decide screen (header pill + the "all decided" empty state) that
   opens the same capture flow helpers use, at `(parent)/capture.tsx` (a
   `href:null` route — kept off the 5-slot bottom bar). Items a **decider**
   captures are auto-marked **Keep** (`useCanDecide()` in `capture.tsx` adds
   `decision:'keep'` + `decidedAt`); contributor captures stay `undecided`.

9. **AI value estimates (Pro)** — a decider can estimate a kept item's resale
   value. Button in the item-detail **Value** row, plus an "Estimate value" chip
   on value-less items in **Keepsakes** and on kept, value-less rows in the
   **Items** list (both deep-link `item/[id]?estimate=1`, which auto-runs). Flow: `src/lib/estimate-value.ts` → edge function
   `estimate-value` → Claude (`claude-sonnet-5`) with the **web_search** tool
   finds comparable listings → returns `{best, low, high, confidence, rationale,
   comparables}`, shown as a card with a "Use $X" button that fills the value.
   **Server-side Pro gate** (item's `household_plans.plan` must be `pro`) and
   photo access (stored `item_photos`, or client-sent base64 for a local photo).
   Needs `ANTHROPIC_API_KEY` (see item 0). Framed as an informal estimate, never
   an appraisal. (Keepsakes chip is a `Text`, not a `Pressable` — RN Web can't
   nest a `<button>` inside the card's `<button>`.)

10. **Group-photo splitting (Pro)** — one shot of several objects → edge
    function `split-photo` (Claude vision finds objects + boxes, server crops
    each out; re-encode strips EXIF) → `SplitReview` screen where the picture
    taker renames/approves each or taps "Approve all"; approved crops become
    normal items (decider captures auto-Keep) and upload via upload-photo.
    Entry points: web Capture (photo picked → "Several items in this shot?")
    and native Capture (name-it form → "Several items? Split with AI").
    Client: `src/lib/split-photo.ts` (web = blob URLs, native = files in
    documentDirectory). Pro gate is server-side (`FREE_FOR_ALL` flag to open
    it up); needs `ANTHROPIC_API_KEY`. AI path untested end-to-end until the
    key is set — verify the first real split.

**Deliberately NOT adopted from the mockup:** the "Assign" decision (conflates
keeping with heir-assignment), the marketing hero (our header is already compact),
and the "Keepsake" brand.

---

## 10. Deferred / next ideas (offered, not yet approved to build)

- **Desktop data-table** view of the inventory (aligned columns) — from the mockup.
- **Slide-over item detail** that keeps the list in context (vs full navigation).
- **Photo-first web capture** — plan exists in
  `.claude/plans/turn-it-into-a-playful-wadler.md`: web Capture currently offers a
  photo-**less** form; make the photo drop-zone the primary path and let any
  photo-less item gain a photo later via `item/[id].tsx`. (`expo-image-picker`
  already installed; helper `pickPhoto()` in `photo-sync.ts`.)

---

## 11. Locked decisions & the riskiest assumption

- **Locked:** declutter-first positioning; 3 phases (loop → estate/memorandum →
  AI/executor); parent is sole authority; heir assignments **private by default**;
  **subscription-only, never ads or data sales**.
- **Riskiest untested assumption:** that elderly parents will actually engage.
  Cheapest test = a shared photo album + weekly calls with **3 real families**
  before building past Phase 1.

---

## 13. 2026-09-08 update (what changed since §9)

Shipped, all on `main` and live via Amplify:

- **Pricing flip** (§7) and the copy sweep that followed it — Welcome, Account &
  sync, Settings Pro card, native upgrade button no longer sell backup/sharing
  or promise a trial.
- **Collections** — named item sets, en-masse capture, one-swipe deciding;
  migration 0011.
- **Sync hardening:** items push on capture and reconcile on connect (insert-only,
  never overwrites a newer edit); edits/deletes/archive sync live; presence banner
  ("Tom is here too"); default decider per household.
- **The cloud link lives on the household record** (`Household.cloudLinkedAt` /
  `lastBackupAt`; persist v6 migrates old devices). `linkedCloudId()` derives from
  the open household — there is no `cloudHouseholdId` field to clear any more.
  `pushHousehold` refuses to recreate a household that was backed up and is now
  gone (steers to Restore). Closed a wrong-household write in onboarding, the
  guard gap on switch, and a stale link surviving sign-out.
- **Household loading never guesses:** one home → load; several → prefer the one
  open on this device, else a picker (sign-in and Restore). Restore/join **merges**
  into the device's homes instead of wiping the others.
- Mobile Account tab (Log out reachable everywhere); Family "+" ; iPhone bottom-bar
  safe area; desktop sign-in loop fixed; rename/remove households.
- `Btn` and the Decide bars have accessible names (RN Web divs take none from a
  Text child). ~60 raw `Pressable`s still don't — see THREADS.md.
- Daily digest verified live end-to-end (cron → no-JWT function → Vault secret).

Known and open (ranked in `THREADS.md`): React #418 hydration mismatch on every
load (static output vs. client-only layout/state — product call pending); batching
of one-swipe collection decides; `item_messages` needs a `household_id`; a shared
labeled tap component + lint rule; `AGENTS.md`/this file drift (this update);
support address; pre-launch polish.

**Working-in-this-repo rule (learned the hard way):** several Claude sessions
edit this folder at once. Stage with **explicit file paths** and check
`git diff --cached --stat` before every commit touching `store.ts`, `sync.ts`
or `realtime.ts` — a bare `git add <file>` once swept another session's
half-finished feature into a commit and broke `main`'s typecheck.

---

## 12. Commands cheat-sheet

```bash
# from C:\Users\kavit\declutter
npm run web            # expo start --web (dev)
npm run lint           # expo lint
npx tsc --noEmit       # typecheck
supabase functions deploy <name>     # deploy one edge function
supabase db push                     # apply migrations
# deploy web = git push origin main  (Amplify auto-builds)
```

**Keep this file and `AGENTS.md` in sync when the project changes.**
