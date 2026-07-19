# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# Declutter

**Branding:** the default user-facing brand is **Declutter** (app.json `name`,
wordmark, store listings, deep-link scheme `declutter`), matching the repo/Expo
slug. "Keepsakes" is the in-app term for kept items (the parent's Keepsakes
tab) — don't confuse it with branding. "Keepsake" is reserved as an alternate
brand name if the branding is revisited before store submission.

A household estate/legacy app — "Swedish death cleaning, together." Children
photograph items in a parent's home; the parent decides keep/donate/let-go via a
swipe queue, records voice stories, assigns heirs (private by default), and can
export a personal-property memorandum. **Full product spec: `docs/SPEC.md`** —
read it before making product decisions. Interactive design mockup:
`docs/mockup/declutter-mockup.html` (open in a browser).

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

## Tech stack

- **App:** Expo SDK 57 (React Native) + expo-router + TypeScript; Expo Web for
  the browser. One codebase → iOS, Android, web. Routes live in `src/app/`.
- **Backend:** Supabase — Postgres + RLS, Auth, private Storage, Edge Functions
  (Deno) for EXIF stripping, AI tagging/valuation, PDF generation.
- **Payments (later):** RevenueCat.

## Commands

```bash
npm run web       # Expo dev server (web)
npm run android   # Expo dev server (Android)
npm run ios       # Expo dev server (iOS; use Expo Go without a Mac)
npm run lint      # ESLint

# DB: apply migrations in supabase/migrations/ to the linked Supabase project
supabase db push
```

## Layout

- `src/app/` — expo-router file-based routes; `src/components/`, `src/hooks/`,
  `src/constants/` — standard scaffold dirs.
- `supabase/migrations/` — SQL migrations. `20260717000001_phase1_core_loop.sql`
  is the Phase-1 schema; it is heavily commented and doubles as DB
  documentation (authority triggers, RLS helper functions, invite state
  machine, append-only audit log, storage policies).
- `docs/SPEC.md` — product spec (roles, phased features, data model, screen
  map, security architecture). `docs/mockup/` — clickable HTML design mockup.

## Conventions & gotchas

- **Zustand v5 selector discipline**: never pass a selector that builds a new
  object/array to `useStore()` — it triggers a "getSnapshot should be cached"
  infinite loop that blank-screens web (Hermes tolerates it, React web does
  not). Use the exported `useShallow`-wrapped hooks in `src/lib/store.ts`
  (`useEntitlement`, `useQueue`, `useKeepsakes`, `useItemMessages`,
  `useActiveHousehold`, …) or single-field selectors only.

- **DB authority checks live in `private.*` SECURITY DEFINER functions** (e.g.
  `private.is_household_member`) to avoid recursive RLS on
  `household_members`. Never write a policy that selects from
  `household_members` directly.
- **Photo uploads go through the EXIF-stripping Edge Function only** — there is
  deliberately no client INSERT policy on `storage.objects`. Don't add one.
- Enums already contain Phase-2/3 values (executor role, heir visibility,
  etc.); later phases add tables, not enum values.
- Phase gating (see SPEC §3/§9): don't build Phase-2 (heirs/memorandum) or
  Phase-3 (AI valuation/executor unlock) features until the Phase-1 loop is
  validated with real families.
- **Supabase**: project `declutter` (`xkzuoogmcfrxicmoybzp`, ca-central-1),
  linked via CLI. URL + publishable key are committed in
  `src/lib/supabase.ts` (public by design; RLS is the boundary). DB password
  in `.dbpassword.local` (gitignored). Migrations: `supabase db push`; auth
  config/email templates: `supabase config push` (use `npx supabase@latest` —
  the installed CLI has a config-push bug). Auth = email six-digit OTP (the
  magic_link template leads with `{{ .Token }}`). Cloud sync v1 =
  snapshot backup/restore in `src/lib/sync.ts` (Settings → Account & sync);
  `localOnly` items are never uploaded. Photos/audio not yet uploaded (await
  EXIF-strip edge function). Service-role/Stripe secrets: Supabase secrets
  only, never the repo.
