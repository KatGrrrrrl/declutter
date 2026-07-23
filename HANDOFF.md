# Inventory Our Home — Session Handoff

> **Read this first in any new session.** It's the single source of truth for
> where the project stands. Open the new session with the working directory set
> to **`C:\Users\kavit\declutter`** — this repo is fully self-contained and must
> **not** be mixed with any other project (e.g. StockPulseNow).
>
> _Last updated: 2026-07-23._

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
| Payments | ⚠️ Code deployed, **blocked** — real `STRIPE_SECRET_KEY` not set |
| Email | ⚠️ Instant delivery works to owner's gmail only until domain verified in Resend |
| iOS/Android | ⛔ Not submitted — blocked on Apple Developer enrollment |

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
│  │  ├─ (child)/              # contributor tabs: capture, rooms, inventory, family
│  │  ├─ (parent)/ or decide   # decider tabs: Decide, Keepsakes, Heirs, Export, Legacy
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
│  ├─ migrations/              # 0001..0007 (see §5)
│  └─ functions/               # 7 edge functions (see §5)
├─ docs/SPEC.md, docs/mockup/declutter-mockup.html
├─ tools/                      # e2e + probe scripts (see §8)
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

**Edge functions** (`supabase/functions/`, deploy: `supabase functions deploy <name>`):
- `create-checkout`, `verify-checkout`, `stripe-webhook` — Stripe (v1 verifies on
  return; no webhook registration needed).
- `upload-photo` — decode/re-encode strips EXIF, 1600px cap, private bucket + signed URLs.
- `invite-member` — Supabase admin invite email on approval.
- `notify-item-added`, `daily-digest` — email notifications.

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

## 7. Pricing & the ONE thing blocking payments

**Pricing model (shipped):** free + **unlimited local** inventory (no item/household
cap on-device); the paywall is at **cloud backup + family sharing + more than one
cloud home**. Monthly **$4.99** (`declutter_pro_monthly`, 499), yearly **$39**
(`declutter_pro_yearly_v2`, 3900). Local limits in `store.ts` are `Infinity`.

**⚠️ BLOCKER:** `STRIPE_SECRET_KEY` was once set to the literal placeholder
`"sk_test_..."` (the example command was run verbatim). Payments will fail until
the **user re-sets it with the real key**:
```bash
npx supabase secrets set STRIPE_SECRET_KEY=sk_test_<REAL_KEY>
```
Verify in ~30s with `node tools/probe-checkout.mjs` (it reported the
"Invalid API Key" placeholder error).

---

## 8. Outstanding / user-action items

| # | Item | Owner | Notes |
|---|---|---|---|
| 1 | Set real `STRIPE_SECRET_KEY` | **user** | Blocks all payments/Pro. `tools/probe-checkout.mjs` verifies. |
| 2 | Verify `inventoryourhouse.com` in **Resend** (DNS) | **user** | Until then, instant emails deliver **only to owner's gmail**. |
| 3 | Set `DIGEST_SECRET` + a scheduler | **user** | Daily-digest email is locked without it. |
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
