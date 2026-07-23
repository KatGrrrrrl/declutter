# Portable Wins → Bootstrap a New App

> **Purpose.** This document lets a fresh Claude session stand up a *new* app in a
> *new* space by reusing the hard-won, proven pieces of this project — while
> rebranding and changing the product mechanics. It is deliberately split into:
> **(A) reuse as-is** (brand-agnostic engineering + UX that cost real debugging to
> get right), **(B) adapt** (product/domain patterns that are great if you stay
> near this space, but should be re-examined when "the workings change"), and
> **(C) re-decide / do NOT carry over** (brand, secrets, IDs).
>
> **How to use it:** open the new (empty) repo, give a Claude session this file,
> work top-to-bottom. Fill in the **Decisions** table (§4) first — everything
> else keys off it. Treat §2 as proven defaults you should not relitigate.
>
> _Source project: "Inventory Our Home" (repo slug `declutter`), a household
> estate/legacy app. Live, on Expo + Supabase + AWS Amplify. This doc carries the
> engineering, not the brand._

---

## 0. The one-paragraph origin

The source app: children photograph a parent's belongings; the parent decides
Keep/Donate/Let-go, records voice stories, privately assigns heirs, and exports a
personal-property memorandum. Free + unlimited on-device; cloud backup, family
sharing, and AI value estimates are paid. It shipped a lot of infrastructure most
apps need — auth, payments, private photo storage, an AI feature, multiplayer
sync, responsive web + native, real deploys. **Those mechanisms transfer even if
the product doesn't.**

---

## 1. Mental model for the move

Think in three buckets for every file/decision:

| Bucket | Meaning | Examples |
|---|---|---|
| **Reuse** (§2) | Brand-agnostic, debugged, correct | Zustand gotchas, RN-Web quirks, edge-function template, auth/payments/photo/AI recipes, deploy pipeline |
| **Adapt** (§3) | Great pattern; re-fit to new mechanics | Role split, capture-first, swipe-to-decide, local-first paywall, privacy tiers |
| **Re-decide / drop** (§4, §6) | Brand & identity, or secret/instance-specific | Name, domain, colors, taxonomy, Supabase project id, OAuth client, Stripe products, seed data, all secrets |

---

## 2. Reuse as-is — the transferable technical foundation

These are the wins that cost debugging time. Copy the *patterns* (and the files,
if the old repo is available) verbatim; only rename symbols.

### 2.1 Stack baseline
- **Expo SDK 57 + expo-router + TypeScript + React Compiler enabled**. Routes live
  in `src/app/`. Path alias `@/*` → `src/*`.
- **TanStack-free client state** via **Zustand v5** with `persist` (AsyncStorage).
- **Supabase** for Postgres + RLS + Auth + Edge Functions (Deno) + private Storage.
- Package manager: npm (CI uses `npm ci`). Keep one lockfile.

### 2.2 Zustand v5 — the blank-screen trap (highest-value gotcha)
- **Object/array selectors MUST go through `useShallow`-wrapped hooks** defined in
  the store module. A raw object/array selector passed to `useStore` triggers a
  "getSnapshot should be cached" **infinite loop that blank-screens the web
  build**. Centralize selectors; never inline `useStore(s => ({...}))`.
- Ids should be **UUIDs from day one** (unifies local + cloud rows; avoids a
  painful remap migration later).

### 2.3 React Native Web quirks (each one bit us)
1. **No `<button>` inside `<button>`.** RN-Web renders a `Pressable` with
   `accessibilityRole="button"` as a real `<button>`. A nested pressable (a chip
   inside a tappable card/row) is invalid HTML and warns. **Fix:** render the
   inner control as a **`Text` with `onPress` + `stopPropagation`** (RN-Web emits
   a `<div>`, valid inside the button; stopPropagation keeps the outer tap out).
2. **`set-state-in-effect` lint rule.** Synchronous `setState` inside `useEffect`
   is flagged. **Fix:** lazy `useState` initializers, not effects, for seeding
   state (e.g. surfacing an error from a URL param).
3. **Left nav rail (`tabBarPosition:'left'`)** defaults `minWidth` to **25% of the
   frame**. **Pin both `minWidth` and `maxWidth`** to your SIDEBAR_WIDTH or it
   renders ~360px.
4. **Active rail pill** uses the active tint as fill → invisible same-color text.
   Set `tabBarActiveBackgroundColor` (tint) + `tabBarActiveTintColor` (heading).
5. **expo-router hard-disables** React Navigation's document-title updater
   (`documentTitle:{enabled:false}`). Use a small `use-document-title` hook.
6. **No working `unmountOnBlur`/`detachInactiveScreens` on RN7 web.** Hide blurred
   tab screens with `display:none` + `aria-hidden` yourself.
7. **iOS safe-area / cut-off tab bar:** `+html.tsx` with `viewport-fit=cover`,
   body safe-area padding, and an explicit web tab-bar height.
8. **Bottom tab bar fits ~5 labels at 375px.** Need a 6th destination? Make it a
   `href:null` route reached from a button, not a tab (see §3.1).

### 2.4 Responsive desktop recipe
- `useIsDesktop()` = `web && width >= 900`. `DESKTOP_CONTENT_MAX = 1080`,
  `SIDEBAR_WIDTH = 232`. ≥900px web → left rail + capped content + multi-up grids.
  Rail footer pinned to bottom via `marginTop:auto` (account/settings + log out).

### 2.5 Edge Function template (copy this shape for every function)
```ts
const cors = { 'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const fail = (s:number, error:string, reason?:string) =>
  Response.json({ ok:false, error, ...(reason?{reason}:{}) }, { status:s, headers:cors });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  // verify_jwt is ON by default → gateway rejects anonymous.
  // (a) user-scoped client from the caller's JWT → RLS is the real authz check:
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY,
    { global:{ headers:{ Authorization: req.headers.get('Authorization') ?? '' } },
      auth:{ persistSession:false } });
  const { data:auth } = await userClient.auth.getUser();
  // (b) service-role client ONLY for writes/reads that must bypass RLS:
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
});
```
- **Authorization = RLS**, not hand-rolled checks: read the target row through the
  *user* client; if RLS hides it, they weren't allowed.
- **Entitlement/paywall gates belong server-side** (see §2.8), never trust the UI.
- supabase-js hides non-2xx bodies behind `error.context` — on the client, read
  `await error.context.json()` to recover your `{reason}` payload.

### 2.6 Auth — custom domain + OAuth (removes "supabase.co" from the sign-in screen)
- Front Supabase with `auth.<yourdomain>`: CLI `supabase domains create/reverify/
  activate`; add a CNAME + two verification TXT records (`_cf-custom-hostname`,
  `_acme-challenge`) at your DNS host. Paid add-on (~$10/mo).
- Point the client `supabase.ts` URL at the custom domain; set an explicit
  `storageKey`; `detectSessionInUrl: Platform.OS === 'web'`.
- Register the OAuth callback `https://auth.<domain>/auth/v1/callback` in a
  **new** Google Cloud project (don't reuse another product's OAuth client).
- Login page pattern: password default; instant signup; OTP + Google as
  alternates; handle OAuth return (session detected → unlock+home; URL error →
  seed into a prominent top **alert banner**, via lazy init not effect).

### 2.7 Payments — Stripe Checkout via edge functions (web v1)
- Functions: `create-checkout` → hosted page; `verify-checkout` on return flips an
  entitlement row; `stripe-webhook` optional (v1 verifies on return, **no webhook
  registration required**).
- **Stripe prices are immutable** — a price change needs a **new `lookup_key`**
  (that's why a repriced plan is `..._v2`).
- Entitlement lives in a DB row (e.g. `household_plans.plan`), written **only by
  the service role**; clients read it. Native store purchases come later
  (RevenueCat to unify).
- Gotcha we hit: someone pasted the literal `sk_test_...` placeholder as the
  secret. Ship a `probe-checkout` script that surfaces "Invalid API Key" fast.

### 2.8 Private photo pipeline (EXIF-safe by construction)
- **One write path:** an `upload-photo` edge function is the *only* way bytes enter
  the private bucket (no client Storage INSERT policy). It decodes → optionally
  downscales (≤1600px) → **re-encodes JPEG**, which drops all EXIF/GPS by
  construction, then service-role uploads to `bucket/{household}/{item}/{uuid}.jpg`
  and writes a metadata row.
- **Reads = short-lived signed URLs**, cached in memory, re-signed under a 5-min
  margin. Bucket never public.
- **base64 helper** handles both surfaces: web = `fetch(uri)→blob→FileReader`;
  native = `expo-file-system` `readAsStringAsync(base64)`. Export it — the AI
  feature reuses it.
- Privacy tier: a `localOnly` flag marks high-sensitivity records that must never
  sync/upload.

### 2.9 AI feature pattern (the value-estimate win, generalizable)
- A Claude call belongs in an **edge function** (key server-side), never the client.
- Recipe: user-client RLS check → **server-side entitlement gate** (Pro) → resolve
  an image (stored photo via service role, or client-sent base64 for local) →
  `POST api.anthropic.com/v1/messages` with **`claude-sonnet-5`** + the
  **`web_search_20250305`** tool for live comparables → **strict JSON** system
  prompt → parse the last `{...}` from the text blocks → validate numbers.
- Handle `stop_reason === 'pause_turn'` by re-POSTing with the assistant turn
  appended (loop a few times). Frame AI output honestly ("informal estimate, not
  an appraisal").
- Cost control: gate to paid users **server-side**, and mention web-search cost.

### 2.10 Email (Resend)
- `RESEND_API_KEY` secret. **Until your domain is verified in Resend it only
  delivers to your own address** (sandbox) — verify DNS before relying on it.
- Prefs pattern: Off / Instant / Daily; instant = a fire-and-forget ping fn; daily
  = a digest fn behind a `DIGEST_SECRET` + a scheduler.

### 2.11 Deploy pipeline (frontend + backend are separate)
- **Frontend:** GitHub `main` → **AWS Amplify** auto-build (`amplify.yml`:
  `expo export web` → `dist`). DNS on **Route 53** (apex → Amplify). Deep links to
  dynamic routes return HTTP 404 but serve `+not-found.html` = full app shell, so
  they render fine in browsers. Deploys are **slow (10–30 min)** — watch the
  bundle hash flip on the live URL to confirm.
- **Backend:** deploy edge functions + push SQL migrations **manually** (not part
  of the Amplify build): `supabase functions deploy <name>`, `supabase db push`.
- **Verify by starting your OWN dev server** (another chat's server may hold a
  port) and driving the in-app browser.

### 2.12 Testing & ops
- A **live-backend e2e script** (two simulated users hitting the real project)
  caught missing SQL `auth.uid()` defaults that unit tests never would. Write one
  early; run with the service-role key.
- **Ops caution inherited from the source:** never fire many concurrent
  edge-function invocations / heavy backfills at a small DB — it drains burst
  CPU/IO credits and can cascade. Batch work **sequentially, off-peak**.

### 2.13 SQL/RLS shape
- `private.*` SECURITY DEFINER helper functions for membership checks; owner-only
  mutation triggers; append-only audit log; **no client Storage INSERT**. Bootstrap
  an entitlement row per top-level entity via an `after insert` trigger.

---

## 3. Adapt — product/UX wins to re-fit to new mechanics

Keep the *shape*; swap the nouns/verbs when "the workings change."

### 3.1 Role-split routing
Two route groups (e.g. `(parent)` / `(child)`) selected by a stored `role`; a
shared screen can live in both groups and vary by role (one `InventoryView`
renders for both). Extra destinations that don't fit the 5-slot bar become
`href:null` routes reached from an in-screen button (that's how "parents catalogue
their own things" was added without a 6th tab).

### 3.2 Capture-first, photo-first
Native = batch camera (shoot, quick-name, back to viewfinder). Web = photo
drop-zone as the primary path, "no photo" demoted. Any photo-less record can gain
a photo later from its detail screen.

### 3.3 Decide loop
One-at-a-time swipe (right/left/down = three outcomes) with gentle progress and a
timed **Undo**. If a capturer is also the authority, auto-apply the "keep"-style
outcome on capture. → **This is the piece most likely to change** when you rework
the workings; keep the undo + progress affordances regardless.

### 3.4 Monetization: local-first, cloud-paywall
Free = unlimited **on-device**; paywall at **cloud backup + sharing + AI**. Clean,
generous, and the paywall lands on genuinely server-cost features. A "Protected &
backed up / On this device — add cloud backup" status card makes the paid value
visible.

### 3.5 At-a-glance workspace
Stat tiles (count / to-do / done / documented value), a value column, and filters
that double as tappable tiles. Data-table + slide-over detail was the next step.

### 3.6 Privacy defaults
Sensitive assignments **private by default** with per-item visibility tiers;
money/value visible only to the authority role; a `localOnly` "never leaves the
device" tier. Re-map these to whatever the new product's sensitive data is.

### 3.7 Collaboration
Invite-by-email with **approval by an organizer/authority** (not a deadlock on a
role that hasn't joined yet), per-item chat, realtime via Supabase channels,
sync v2 = upsert-merge (authority pushes all; contributors push only their own
un-decided rows).

### 3.8 Onboarding & export
Set up the top-level entity, name the authority, invite members, sign in at the
end (links local → cloud). A structured **export** (memorandum/PDF-style) is a
strong closing deliverable — re-theme it to the new domain.

---

## 4. Decisions to re-make for the new brand (fill this in FIRST)

The new session should resolve these before writing code; most of §2/§3 keys off
them.

| Decision | Source value | New value |
|---|---|---|
| Product name (brand) | Inventory Our Home | ? |
| Repo / slug / scheme | `declutter` | ? |
| Domain | inventoryourhouse.com | ? |
| Core taxonomy (the "decisions") | Keep / Donate / Let-go | ? |
| Top-level entity | Household | ? |
| Record entity | Item (photo + value + heir + story) | ? |
| Authority role vs helper role | Parent (decider) / Child (contributor) | ? |
| Sensitive/private field(s) | Heir assignment, value | ? |
| What "changes in the workings" | — | ? (describe) |
| Pricing | Free local / $4.99mo / $39yr | ? |
| Palette + type | warm cream + navy heading + serif | ? |
| Platforms at launch | Web now; iOS/Android later | ? |

---

## 5. Bootstrap recipe (order of operations)

1. **Scaffold**: `npx create-expo-app@latest` (SDK 57, TS, expo-router). Enable the
   React Compiler. Set `@/*` alias. Add `+html.tsx` (safe-area) and an
   `amplify.yml` (`expo export web` → `dist`).
2. **Design tokens**: create `src/constants/theme.ts` (`T` colors, `Fonts`,
   `Radius`, `Spacing`) from §4's palette. Everything else references these.
3. **UI primitives**: port `src/components/ui.tsx` (Screen/Title/Heading/Btn/Card/
   Row/PhotoBox + `NavigationTabBar` rail + `useIsDesktop`/`useTabBarLayout`).
   Bring the RN-Web fixes in §2.3 with them.
4. **Store**: port `src/lib/store.ts` structure — `useShallow` selectors, UUID ids,
   persist + migrations, entitlement selector. Swap entities per §4.
5. **Supabase**: new project (own org/region). Port the migration *shape* (§2.13),
   renaming tables. `supabase link` + `db push`. Client `supabase.ts` with explicit
   `storageKey`.
6. **Photo + AI + email + payments**: port `upload-photo`, `estimate-value`
   (or your new AI fn), notify/digest, and `create-checkout`/`verify-checkout`
   from `supabase/functions/` using the §2.5 template. New Stripe products (new
   `lookup_key`s).
7. **Auth**: custom domain (§2.6) + a **new** Google OAuth client. Login page.
8. **Deploy**: GitHub repo → Amplify app → Route 53 apex. Push `main`; watch the
   bundle hash flip.
9. **Secrets** (all NEW, set by the human — Claude must not enter keys):
   `ANTHROPIC_API_KEY`, `STRIPE_SECRET_KEY`, `RESEND_API_KEY`, `DIGEST_SECRET`.
10. **e2e script** (§2.12) against the new project; then build features.

Files worth copying near-verbatim (rename symbols only): `constants/theme.ts`,
`components/ui.tsx`, `lib/photo-sync.ts`, `lib/estimate-value.ts`, `lib/supabase.ts`,
`+html.tsx`, `amplify.yml`, and every `supabase/functions/*` using the §2.5 shape.

---

## 6. Do NOT carry over

- Brand strings, wordmark, domain, permission copy, email subjects.
- The Supabase **project id / keys**, the **OAuth client**, **Stripe products**,
  the **custom domain** — all are instance-specific; make new ones.
- **Any secret value** (they're per-project; a human sets them in the new project).
- Seed/demo data and the specific taxonomy if the workings change.
- This project's `HANDOFF.md` (that's for continuing *this* app) — this
  `PORTABLE-WINS.md` is the transfer doc.

---

## 7. Kickoff prompt for the new session (paste this)

> I'm starting a new app in this empty repo. It reuses the proven architecture of
> a prior Expo + Supabase + Amplify project, but with a new brand and somewhat
> different mechanics. Read `PORTABLE-WINS.md`. First, ask me the open questions in
> its **Decisions** table (§4) — especially the new name, domain, core taxonomy,
> and what changes in the workings. Then follow the **Bootstrap recipe** (§5),
> treating §2 as proven defaults (don't relitigate the Zustand/RN-Web/edge-function
> gotchas) and adapting §3 to the new mechanics. Do NOT reuse any secret, project
> id, OAuth client, or Stripe product from the old app — we'll create fresh ones.
> Confirm the plan before scaffolding.

---

_Keep this document with the new project's `docs/`. Update §2 whenever you learn a
new cross-project lesson — it's the compounding asset._
