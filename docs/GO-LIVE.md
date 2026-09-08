# Go-live runbook — Inventory Our Home

_Last updated: Sep 7, 2026._
_Companion to [`HANDOFF.md`](../HANDOFF.md) (full project state), [`docs/PRICING.md`](PRICING.md) (source of truth for what Pro is and costs), and [`THREADS.md`](../THREADS.md) (in-flight work). This file is the launch-day checklist: what must be true before we take real money and open the doors._

The web app is already **live** at https://inventoryourhouse.com and the backend is in production. "Go live" here means **switching payments from test to real** and clearing the remaining launch blockers — not a first deploy.

> **Pricing changed on Sep 7, 2026:** cloud backup, family sharing and multi-home are now **free**. Pro ($4.99/mo · $39/yr) unlocks only the **AI layer** — value estimates and group-photo splitting — both gated server-side in the Edge Functions. Anything below that mentions Pro means those two AI features.

---

## 0. The headline: we are on a Stripe TEST key

**Payments currently run against a Stripe _test_ key (`sk_test_…`).** No real card is ever charged, and any "successful" checkout in this state is a sandbox transaction. **Before launch we must set a live key (`sk_live_…`).** This is the single most important go-live step — it's the only thing standing between "AI features are free for everyone who clicks through" and an actual business.

The secret lives in **Supabase secrets only** (never in the repo). Setting it:

```bash
# from C:\Users\kavit\declutter — use the REAL live key, not the placeholder
npx supabase secrets set STRIPE_SECRET_KEY=sk_live_XXXXXXXXXXXXXXXXXXXX
```

> ⚠️ History note: this secret was once set to the literal placeholder `sk_test_...`, which made checkout fail with "Invalid API Key." Paste the actual key, not the example.

### Live-mode prices bootstrap themselves — but verify the first one

Stripe keeps **test mode and live mode fully separate**: prices and `lookup_key`s from test mode don't exist in live mode. You do **not** need to recreate them by hand — `create-checkout` **finds-or-creates** the product and price by lookup key on first use ([`create-checkout/index.ts:97`](../supabase/functions/create-checkout/index.ts)):

- `declutter_pro_monthly` — $4.99 (`499`)
- `declutter_pro_yearly_v2` — $39.00 (`3900`)

So the **first live checkout creates the live catalog**. That makes it the one to watch: afterwards, open the Stripe live dashboard and confirm exactly one "Inventory Our Home" product with those two prices and amounts. (Stripe prices are immutable — a price change needs a *new* lookup key, which is why yearly is `_v2`.)

### Verify

```bash
node tools/probe-checkout.mjs        # expect a real checkout.stripe.com URL, no "Invalid API Key"
```

Then do one real end-to-end purchase (a live card, small amount, refundable) and confirm the household flips to `pro` **and an AI value estimate now returns a result** — that's what the purchase actually unlocks.

> The secret was once the literal `sk_test_...` placeholder, and Supabase secrets are write-only, so you can't read back what's there. **The probe is the only proof.** Never assume the key is right because it was "set."

---

## 1. Launch blockers (must-do before opening up)

| # | Blocker | Owner | How to clear / verify |
|---|---------|-------|-----------------------|
| 1 | **Stripe live key** (see §0) | user | `npx supabase secrets set STRIPE_SECRET_KEY=sk_live_…`; `node tools/probe-checkout.mjs`; one real purchase; confirm the auto-created live catalog in the dashboard |
| 2 | **Resend domain verification** for `inventoryourhouse.com` | user | Add DNS records in Route 53; until verified, instant emails deliver **only to the owner's gmail** |
| 3 | **Millrun duplicate-household cleanup** (data integrity) | user + Claude | Follow the recovery sequence in [`THREADS.md`](../THREADS.md): merge items → delete duplicate → **Restore** on the phone (not Back up) |
| 4 | **Testing Pro grants reverted** | user + Claude | Any household flipped to Pro without paying keeps the AI features free in production. Run `node tools/make-household-pro.mjs --free "<name>"` for every entry in the grant log in [`PRICING.md`](PRICING.md) §5, then confirm a free household still gets `pro_required` |

✅ **No longer a blocker:** `ANTHROPIC_API_KEY` is set (Sep 7, 2026) and both AI features are live. Still worth a real run of each before launch, since that's what paying customers get — see the smoke test in §5.

### A cost note that comes with free sync

Making backup and sharing free inverted the cost story: **Supabase now carries every household, while only AI users pay.** Pro has to cover the Anthropic spend *and* subsidise storage/egress for free households. Fine at typical use (a $39 subscriber costs a few dollars a year in API calls), but **there is no per-household usage cap today** — a heavy AI user could invert the margin. Not a launch blocker; a thing to watch once real families are on it. Details in [`PRICING.md`](PRICING.md).

---

## 2. Pre-launch polish (not hard blockers, but do before marketing)

| # | Item | Owner | Notes |
|---|------|-------|-------|
| 5 | Replace Expo placeholder app icons | pre-launch | Still default Expo icons in `app.json` |
| 6 | Rebrand Google OAuth client to its own Declutter GCP project | pre-launch | Currently lives in the OurGroupTrips GCP project |
| 7 | Test Google sign-in on the custom domain | user | Consent screen should read "continue to auth.inventoryourhouse.com" |
| 8 | Daily digest — **now live** | — | Migration `20260908000010` (applied) installs `pg_cron` + `pg_net` and schedules `daily-digest` at 23:00 with a Vault secret; cron job verified active. `DIGEST_SECRET` is an optional override, not required. **Keep the function deployed with `--no-verify-jwt`** (see §5) or every cron run 401s and the "Daily summary" setting goes silently dead again. |
| 9 | Custom SMTP | pre-launch | Built-in mailer caps at a few emails/hr; Resend covers most volume |

---

## 3. Mobile (deferred — separate track)

- **iOS/Android are not submitted.** Blocked on **Apple Developer enrollment** (needed for Apple sign-in + App Store). Web launch does not depend on this.

---

## 4. Secrets checklist (Supabase → project `declutter`)

Set in Supabase secrets only — never in the repo. Confirm each is the **production/live** value, not a placeholder or test value:

- [ ] `STRIPE_SECRET_KEY` = `sk_live_…`  ← **currently a test key**
- [x] `ANTHROPIC_API_KEY` = `sk-ant-…`  ← set Sep 7, 2026; one key serves both AI functions
- [x] Daily-digest secret — generated in **Vault** by migration `20260908000010`; `DIGEST_SECRET` is only an optional override
- [ ] Resend API key / domain verified
- [ ] Service-role key stays server-side only (used by `tools/e2e-*` locally, never shipped)

---

## 5. Deploy & verify

```bash
# web deploy = push to main; AWS Amplify auto-builds (10–30 min)
git push origin main

# edge functions (deploy individually after changes)
supabase functions deploy create-checkout
supabase functions deploy verify-checkout
# …etc

# ⚠️ daily-digest is called by pg_cron with NO Authorization header — it MUST
# stay deployed with JWT verification off, or the schedule silently 401s:
supabase functions deploy daily-digest --no-verify-jwt

# migrations
supabase db push
```

**Confirm a deploy is actually live:** watch the bundle hash on the site change (the `entry-*.js` filename changes) — do not assume the push == live. Amplify app `d3mbyx420tjxzh`; DNS on Route 53.

### Smoke test after go-live
- [ ] Sign in (email OTP) on the live domain
- [ ] **Free tier works without paying:** capture an item on a phone → it syncs to the cloud and appears on a second device; an invited family member accepts and sees the full inventory
- [ ] On a **free** household, tap an AI value estimate → get `pro_required` (the paywall holds server-side)
- [ ] Buy Pro with a **real** card → household flips to `pro`
- [ ] Now the AI value estimate returns a result, and a group-photo split works — **this is what the money buys**
- [ ] Confirm the auto-created live product/prices in the Stripe dashboard (§0)
- [ ] Refund the test purchase
- [ ] A notification email lands (confirms Resend domain)

---

## 6. Rollback

- Web is a static Amplify build from `main` — roll back by reverting the commit and pushing, or redeploying a previous Amplify build.
- **Stripe:** if a live-mode problem appears, unsetting/rotating `STRIPE_SECRET_KEY` disables checkout (fails closed) without touching anything else.
- Edge-function changes roll back per function via `supabase functions deploy` of the prior version.

---

## Go / No-go

**Go when:** items 1–3 in §1 are cleared and the §5 smoke test passes end-to-end with a real card — including proving the paywall holds on a free household and opens on a paid one.
**Currently: NO-GO for paid launch** — Stripe is on a test key (§0). Everything free-tier (sync, sharing, multi-home) is already live and unaffected.
