# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# Inventory Our Home (repo: `declutter`)

**Branding:** the user-facing brand is **Inventory Our Home** (app.json `name`,
wordmark, emails, live at https://inventoryourhouse.com). `declutter` is the
repo, Expo slug, deep-link scheme and Stripe product slug — **technical only,
never shown to users**. "Keepsakes" is the in-app term for kept items (the
parent's Keepsakes tab), not a brand.

A household estate/legacy app — "Swedish death cleaning, together." Children
photograph items in a parent's home; the parent decides keep/donate/let-go via a
swipe queue, records voice stories, assigns heirs (private by default), and can
export a personal-property memorandum. **Full product spec: `docs/SPEC.md`.**

**Read before touching anything:** `HANDOFF.md` (project state, gotchas that
cost hours), `THREADS.md` (open bugs, ranked, with recovery sequences),
`docs/PRICING.md` (what Pro is — source of truth), `docs/GO-LIVE.md` (launch
checklist).

## Core principles (never violate)

- **The parent (owner) is the sole authority.** Contributors (children) capture
  and suggest; only owners decide items or assign heirs. Enforced in the DB
  (RLS + triggers), not just the UI.
- **Heir assignments are private to the owner by default**, with per-item
  reveal controls. Children must never see each other's item requests.
- **Security posture is a feature**: this is a photographed, valued catalog of
  an elder's home. EXIF/GPS stripped server-side before storage; photos in the
  private bucket only, served via short-lived signed URLs; no public links;
  subscription-funded, never ads or data sales.
- **Parent-facing UI is radically simple**: big targets, voice over typing,
  swipe decisions, warm non-morbid tone. Child-facing UI can be denser.

## Pricing (changed 2026-09-07 — do not reintroduce the old model)

The inventory is **free and unlimited everywhere**: on the device, backed up to
the cloud, shared with the family, any number of homes. The **only paid layer is
AI** — value estimates (`estimate-value`) and group-photo splitting
(`split-photo`), gated **server-side** on `household_plans.plan = 'pro'`.
$4.99/mo · $39/yr via Stripe Checkout. Any copy, comment or check that treats
backup/sharing/multi-home as Pro is a regression. Stripe is currently on a
**test** key (see GO-LIVE §0).

## Tech stack

- **App:** Expo SDK 57 (React Native) + expo-router + TypeScript; Expo Web for
  the browser (`web.output: "static"`). One codebase → iOS, Android, web. Routes
  live in `src/app/`. Web is live on AWS Amplify (auto-build from `main`);
  iOS/Android not yet submitted.
- **State:** Zustand v5 with `persist` (AsyncStorage), `src/lib/store.ts`.
  Persist version is bumped with a `migrate` whenever the shape changes.
- **Backend:** Supabase — Postgres + RLS, Auth, private Storage, 10 Edge
  Functions (Deno): Stripe checkout/verify/webhook, EXIF-stripping photo upload,
  AI estimate + split, invites, invite-declined email, item-added email, daily
  digest.
- **Auth:** email + password, six-digit email code (OTP), and Google OAuth, on
  the custom domain `auth.inventoryourhouse.com`. Apple sign-in awaits developer
  enrollment.
- **Payments:** Stripe Checkout through Edge Functions (`create-checkout`
  finds-or-creates prices by lookup key). RevenueCat is **not** in use.

## Commands

```bash
npm run web       # Expo dev server (web)
npm run android   # Expo dev server (Android)
npm run ios       # Expo dev server (iOS; use Expo Go without a Mac)
npm run lint      # ESLint
npx tsc --noEmit  # typecheck — run both before every commit

supabase db push                              # apply supabase/migrations/
supabase functions deploy <name>              # one edge function
supabase functions deploy daily-digest --no-verify-jwt   # ALWAYS this flag: cron sends no JWT
# web deploy = git push origin main (Amplify builds; confirm by the entry-*.js hash changing)
```

## Layout

- `src/app/` — expo-router routes: `(child)/` contributor tabs, `(parent)/`
  decider tabs, `item/[id]`, `collection/[id]`, `login`, `onboarding`,
  `settings`, `upgrade`. `src/components/`, `src/hooks/`, `src/constants/`.
- `src/lib/` — `store.ts` (state + `useShallow` hooks), `sync.ts` (upsert
  merge, backup/restore, reconcile), `realtime.ts` + `presence.ts`, `join.ts`
  (invites, which-household-to-load policy), `billing.ts`, `photo-sync.ts`.
- `supabase/migrations/` — 0001 is the Phase-1 schema and doubles as DB
  documentation (authority triggers, RLS helpers, invite state machine,
  append-only audit log). 0002–0015 evolve it; read the headers. Heir
  assignments are their own RLS-hidden rows (0014) — never columns on items.
- `docs/` — `SPEC.md`, `PRICING.md`, `GO-LIVE.md`, `SHIPPING.md` (EAS/store
  setup), `mockup/`. `THREADS.md` at the root tracks sessions and open work.
- `tools/` — live-backend e2e scripts (`SERVICE_KEY=… node tools/e2e-*.mjs`),
  `probe-checkout.mjs`, `make-household-pro.mjs [--free]`, `cleanup-orphans.sql`.

## Conventions & gotchas

- **Several Claude sessions work in this folder at once.** Stage with
  **explicit file paths** and check `git diff --cached --stat` before every
  commit — especially for `store.ts`, `sync.ts`, `realtime.ts`. A bare
  `git add <file>` once swept another session's half-finished feature into a
  commit and broke `main`. Never run a dev server on a port another session
  is using; never commit `supabase/.temp/cli-latest` or `.claude/launch.json`.
- **Zustand v5 selector discipline**: never pass a selector that builds a new
  object/array to `useStore()` — it triggers a "getSnapshot should be cached"
  infinite loop that blank-screens web (Hermes tolerates it, React web does
  not). Use the exported `useShallow`-wrapped hooks in `src/lib/store.ts`
  (`useEntitlement`, `useQueue`, `useKeepsakes`, `useItemMessages`,
  `useActiveHousehold`, `useCollectionItems`, …) or single-field selectors only.
- **The cloud link lives on the household record.** `Household.cloudLinkedAt`
  / `lastBackupAt`; the writable cloud id is `linkedCloudId(s)` (derived from
  the OPEN household). There is no top-level `cloudHouseholdId` — don't add
  one back, and don't "clear the link" on switch/add/remove: there is nothing
  to clear. `pushHousehold` refuses to recreate a household that was backed up
  and is now gone (it steers to Restore). Loading a household never guesses
  which: one → load; several → prefer the open one, else ask
  (`join.pickMyHousehold`). Restore/join **merges** into the device's homes.
- **Sync is v2 upsert-merge, not snapshot:** items push on capture, edits and
  deletes mirror live, reconcile-on-connect is insert-only (never overwrites a
  newer edit). Owners push everything; contributors push only their own
  undecided items; `localOnly` items never leave the device. Photos upload via
  the EXIF-stripping `upload-photo` function (swept on every backup); voice
  audio still stays on the device.
- **DB authority checks live in `private.*` SECURITY DEFINER functions** (e.g.
  `private.is_household_member`) to avoid recursive RLS on
  `household_members`. Never write a policy that selects from
  `household_members` directly. `items.household_id` and `created_by` are
  immutable by trigger — items are never moved between households.
- **Photo uploads go through the EXIF-stripping Edge Function only** — there is
  deliberately no client INSERT policy on `storage.objects`. Don't add one.
- **Accessibility on web:** RN Web renders `Pressable` as a `div`, which takes
  no accessible name from a `Text` child. `Btn` passes `accessibilityLabel`
  automatically; a raw `Pressable` with `accessibilityRole="button"` must set
  one explicitly (many still don't — see THREADS.md).
- **Static web output hydrates against client-only state** (`useIsDesktop()`,
  the persisted store), so React #418 fires on every load today. Don't add
  more render-time viewport or storage reads; the fix direction is a `mounted`
  gate or `web.output: "single"` — pending a product decision.
- **Phases:** heirs, the memorandum export, and AI valuation are shipped.
  Still gated: the executor-unlock flow (Phase 3). Enums already contain the
  values; later phases add tables, not enum values.
- **Supabase**: project `declutter` (`xkzuoogmcfrxicmoybzp`, ca-central-1),
  linked via CLI. URL + publishable key are committed in `src/lib/supabase.ts`
  (public by design; RLS is the boundary). DB password in `.dbpassword.local`
  (gitignored). Auth config/email templates: `supabase config push` (use
  `npx supabase@latest` — the installed CLI has a config-push bug). Secrets
  (`STRIPE_SECRET_KEY`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, service role):
  Supabase secrets only, never the repo. Supabase secrets are write-only —
  `tools/probe-checkout.mjs` is the only proof the Stripe key is right.
