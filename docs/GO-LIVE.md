# Go-live runbook — Inventory Our Home

_Last updated: Sep 7, 2026._
_Companion to [`HANDOFF.md`](../HANDOFF.md) (full project state) and [`THREADS.md`](../THREADS.md) (in-flight work). This file is the launch-day checklist: what must be true before we take real money and open the doors._

The web app is already **live** at https://inventoryourhouse.com and the backend is in production. "Go live" here means **switching payments from test to real** and clearing the remaining launch blockers — not a first deploy.

---

## 0. The headline: we are on a Stripe TEST key

**Payments currently run against a Stripe _test_ key (`sk_test_…`).** No real card is ever charged, and any "successful" checkout in this state is a sandbox transaction. **Before launch we must set a live key (`sk_live_…`) and confirm live-mode pricing.** This is the single most important go-live step — everything about Pro (cloud backup, family sharing, more than one cloud home) depends on it.

The secret lives in **Supabase secrets only** (never in the repo). Setting it:

```bash
# from C:\Users\kavit\declutter — use the REAL live key, not the placeholder
npx supabase secrets set STRIPE_SECRET_KEY=sk_live_XXXXXXXXXXXXXXXXXXXX
```

> ⚠️ History note: this secret was once set to the literal placeholder `sk_test_...`, which made checkout fail with "Invalid API Key." Paste the actual key, not the example.

### Stripe live-mode also needs its prices

Stripe keeps **test mode and live mode fully separate** — prices, products, and `lookup_key`s created in test mode **do not exist in live mode**. The app resolves prices by lookup key, so live mode must have matching ones:

- `declutter_pro_monthly` — $4.99 (`499`)
- `declutter_pro_yearly_v2` — $39.00 (`3900`)

Recreate both **products/prices in the Stripe live dashboard with the same lookup keys** before flipping the key. (Reminder: Stripe prices are immutable — a price change needs a *new* lookup key, which is why yearly is `_v2`.)

### Verify

```bash
node tools/probe-checkout.mjs        # expect a real checkout.stripe.com URL, no "Invalid API Key"
```

Then do one real end-to-end purchase (a live card, small amount, refundable) and confirm the household flips to `pro`.

---

## 1. Launch blockers (must-do before opening up)

| # | Blocker | Owner | How to clear / verify |
|---|---------|-------|-----------------------|
| 1 | **Stripe live key + live prices** (see §0) | user | `npx supabase secrets set STRIPE_SECRET_KEY=sk_live_…`; recreate prices in live mode; `node tools/probe-checkout.mjs`; one real purchase |
| 2 | **`ANTHROPIC_API_KEY`** — powers AI value estimates & group-photo split | user | `npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-…`; the AI split path is untested until this is set — verify the first real split |
| 3 | **Resend domain verification** for `inventoryourhouse.com` | user | Add DNS records in Route 53; until verified, instant emails deliver **only to the owner's gmail** |
| 4 | **Millrun duplicate-household cleanup** (data integrity) | user + Claude | Follow the recovery sequence in [`THREADS.md`](../THREADS.md): merge items → delete duplicate → **Restore** on the phone (not Back up) |

---

## 2. Pre-launch polish (not hard blockers, but do before marketing)

| # | Item | Owner | Notes |
|---|------|-------|-------|
| 5 | Replace Expo placeholder app icons | pre-launch | Still default Expo icons in `app.json` |
| 6 | Rebrand Google OAuth client to its own Declutter GCP project | pre-launch | Currently lives in the OurGroupTrips GCP project |
| 7 | Test Google sign-in on the custom domain | user | Consent screen should read "continue to auth.inventoryourhouse.com" |
| 8 | `DIGEST_SECRET` + a scheduler for the daily digest | user | The "Daily summary" notification option is **dead** until a scheduler calls `daily-digest` (no `pg_cron` installed) — either wire it or hide the setting |
| 9 | Custom SMTP | pre-launch | Built-in mailer caps at a few emails/hr; Resend covers most volume |

---

## 3. Mobile (deferred — separate track)

- **iOS/Android are not submitted.** Blocked on **Apple Developer enrollment** (needed for Apple sign-in + App Store). Web launch does not depend on this.

---

## 4. Secrets checklist (Supabase → project `declutter`)

Set in Supabase secrets only — never in the repo. Confirm each is the **production/live** value, not a placeholder or test value:

- [ ] `STRIPE_SECRET_KEY` = `sk_live_…`  ← **currently a test key**
- [ ] `ANTHROPIC_API_KEY` = `sk-ant-…`
- [ ] `DIGEST_SECRET` (only if enabling the daily digest)
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

# migrations
supabase db push
```

**Confirm a deploy is actually live:** watch the bundle hash on the site change (the `entry-*.js` filename changes) — do not assume the push == live. Amplify app `d3mbyx420tjxzh`; DNS on Route 53.

### Smoke test after go-live
- [ ] Sign in (email OTP) on the live domain
- [ ] Capture an item on a phone → it appears in the cloud and on a second device
- [ ] Buy Pro with a **real** card → household flips to `pro`, cloud backup unlocks
- [ ] Refund the test purchase
- [ ] An invited family member accepts and sees the full inventory
- [ ] AI value estimate returns a result (confirms `ANTHROPIC_API_KEY`)
- [ ] A notification email lands (confirms Resend domain)

---

## 6. Rollback

- Web is a static Amplify build from `main` — roll back by reverting the commit and pushing, or redeploying a previous Amplify build.
- **Stripe:** if a live-mode problem appears, unsetting/rotating `STRIPE_SECRET_KEY` disables checkout (fails closed) without touching anything else.
- Edge-function changes roll back per function via `supabase functions deploy` of the prior version.

---

## Go / No-go

**Go when:** items 1–4 in §1 are cleared and the §5 smoke test passes end-to-end with a real card.
**Currently: NO-GO for paid launch** — Stripe is on a test key (§0).
