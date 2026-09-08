# Products & Pricing — Inventory Our Home

The commercial "assets" for this project: what customers can buy, and the paid
services the app depends on. **Source of truth for each row is cited** — update
this file when those change.

_Brand shown to users: **Inventory Our Home**. Repo/Stripe slug: `declutter`._
_Last updated: 2026-09-07._

---

## 1. What customers buy

### Free — "With the family"
| | |
|---|---|
| Price | **$0**, no card, no trial clock |
| What's included | Unlimited rooms, items, photos, voice stories, **cloud backup, family sharing and live sync, more than one home** |
| Enforced by | `FREE_ITEM_LIMIT = Infinity` and `cloudEnabled: true` in `src/lib/store.ts` (decided 2026-09-07: sync is never paywalled — a family should not lose its shared inventory when a card lapses) |

### Inventory Our Home Pro — "A little help from AI"
The single paid product. Adds the AI layer on top of the free, synced app.

| Plan | Price | Billing | Stripe `lookup_key` | `unit_amount` | Interval |
|---|---|---|---|---|---|
| **Monthly** | **$4.99** | each month | `declutter_pro_monthly` | `499` | `month` |
| **Yearly** | **$39** | once a year (~$3.25/mo) | `declutter_pro_yearly_v2` | `3900` | `year` |

- **Currency:** USD.
- **Stripe product name:** `Inventory Our Home Pro` (one product; the two plans
  are two prices under it).
- **Source of truth:** [`supabase/functions/create-checkout/index.ts`](../supabase/functions/create-checkout/index.ts)
  — the `PLANS` map (amounts + lookup keys) and `PRODUCT_NAME`. Product + prices
  are **found-or-created by lookup key** on first checkout, so no manual Stripe
  dashboard setup is required.
- **Displayed to users:** [`src/app/upgrade.tsx`](../src/app/upgrade.tsx) `PLANS`
  array. Keep those strings in sync with the amounts above. Stripe prices are
  immutable, so any change needs a **new `lookup_key`** — that is why the yearly
  one is `_v2` (it carried the earlier $49.99 price).

**What Pro unlocks** (from `BENEFITS` in `upgrade.tsx`):
1. **AI value estimates** — see §2; gated server-side on `household_plans.plan = 'pro'`.
2. **AI photo splitting** — one group photo → separate items; same server-side gate (`split-photo`).
3. **"Funds the app, not ads"** — not a feature; the standing promise that the
   subscription is the business model (see the core principles in `AGENTS.md`).

Both gates are enforced in the Edge Functions, not the UI, so a client that
skips the paywall still gets `pro_required` back.

Cloud backup, family sharing and multi-home were Pro features until 2026-09-07 and are now free.

**Entitlement storage:** `public.household_plans.plan` (`'free' | 'pro'`), written
only by the service role via the Stripe flow; clients read it.
`verify-checkout` flips it to `pro` on return from Stripe.

---

## 2. Paid services the app consumes (cost side)

These are the vendor products/keys the app spends money on. Amounts vary with
usage — check each dashboard for live figures.

| Service | Used for | Key / config | Cost basis | Status |
|---|---|---|---|---|
| **Stripe** | Collecting the Pro subscription | `STRIPE_SECRET_KEY` (Supabase secret) | Standard Stripe per-transaction fees (~2.9% + 30¢): $4.99 nets ~$4.55, $39 nets ~$37.57 | Secret is present. It was once set to the literal `sk_test_...` placeholder, and secrets are write-only, so **confirm with `node tools/probe-checkout.mjs`** before trusting checkout |
| **Anthropic API** | AI value estimates — `claude-sonnet-5` + `web_search`; group-photo splitting (`split-photo`, plain vision call, cheaper) | `ANTHROPIC_API_KEY` (Supabase secret) | Rough per use: estimate **~$0.05–0.15** (one call *with* web search), split **~$0.01–0.02** (one vision call). Both Pro-gated to cap spend. | Set (2026-09-07). One key serves both functions |
| **Supabase** | Postgres, Auth, private Storage, Edge Functions | project `xkzuoogmcfrxicmoybzp` (ca-central-1) | Plan tier + usage | Live |
| **Supabase custom auth domain** | `auth.inventoryourhouse.com` on the sign-in screen | domain add-on | ~$10/mo add-on | Live |
| **Resend** | Transactional email (invites, notifications, digest) | `RESEND_API_KEY` (Supabase secret) | Free tier / usage-based | Live — but only delivers to the owner's own address until `inventoryourhouse.com` is verified in Resend |
| **AWS Amplify + Route 53** | Web hosting + DNS for `inventoryourhouse.com` | Amplify app `d3mbyx420tjxzh` | Build minutes + hosting + hosted-zone fee | Live |

**Margin note.** Cloud backup and sharing are now free, so Supabase carries
every household while only AI users pay. Pro therefore has to cover the
Anthropic spend *and* subsidise storage/egress for free households — worth
watching once real families are on it. At typical use (a few dozen valuations a
year) a $39 subscriber costs a few dollars in API calls, so the margin holds;
a heavy user could invert it. There is no per-household usage cap today.

**Model / tooling reference (for the AI cost line):**
[`supabase/functions/estimate-value/index.ts`](../supabase/functions/estimate-value/index.ts)
— `MODEL = 'claude-sonnet-5'`, tool `web_search_20250305` (max 5 searches/estimate).

---

## 3. Not in use yet

- **RevenueCat** — planned for unifying App Store / Play Store purchases when the
  mobile apps ship (see `AGENTS.md`). No native in-app purchases wired today; the
  paywall is web/Stripe only.
- **Stripe webhook** — `stripe-webhook` is deployed but v1 verifies on return
  (`verify-checkout`); no webhook registration is required for the current flow.

---

## 4. Quick change guide

- **Change a price:** Stripe prices are immutable. Bump the `lookup_key` (e.g.
  `_v3`) and `unit_amount` in `create-checkout`, and update the displayed string
  in `upgrade.tsx`. Old subscribers stay on their old price.
- **Change what Pro unlocks:** edit `BENEFITS` in `upgrade.tsx` and the relevant
  server-side gate (e.g. the `household_plans.plan = 'pro'` check in
  `estimate-value`).
- **Verify Stripe is live:** `node tools/probe-checkout.mjs`.
