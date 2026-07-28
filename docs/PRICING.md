# Products & Pricing — Inventory Our Home

The commercial "assets" for this project: what customers can buy, and the paid
services the app depends on. **Source of truth for each row is cited** — update
this file when those change.

_Brand shown to users: **Inventory Our Home**. Repo/Stripe slug: `declutter`._
_Last updated: 2026-07-24._

---

## 1. What customers buy

### Free — "On this device"
| | |
|---|---|
| Price | **$0**, no card, no trial clock |
| What's included | Unlimited rooms, items, photos, and voice stories — all stored locally on the device |
| Enforced by | `FREE_ITEM_LIMIT = Infinity` in `src/lib/store.ts` (local tier is genuinely unlimited) |

### Inventory Our Home Pro — "With the family"
The single paid product. Adds the cloud layer on top of the free local app.

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
  array. ⚠️ Keep the displayed strings in sync with the amounts above — a stale
  header comment in that file still says "$4.99 / $49.99 placeholders"; the real
  yearly price is **$39** (the reason the yearly key is `_v2` — Stripe prices are
  immutable, so the $49.99→$39 change needed a new lookup key).

**What Pro unlocks** (from `BENEFITS` in `upgrade.tsx` + the AI feature):
1. **Cloud backup** — restore the inventory on any device if a phone is lost/broken.
2. **Family sharing** — invite family to join from their own phones; live sync + chat.
3. **More than one home, in the cloud** — e.g. Mum's house and the cottage, backed up separately.
4. **AI value estimates** — Pro-only; see §2, gated server-side on `household_plans.plan = 'pro'`.

**Entitlement storage:** `public.household_plans.plan` (`'free' | 'pro'`), written
only by the service role via the Stripe flow; clients read it.
`verify-checkout` flips it to `pro` on return from Stripe.

---

## 2. Paid services the app consumes (cost side)

These are the vendor products/keys the app spends money on. Amounts vary with
usage — check each dashboard for live figures.

| Service | Used for | Key / config | Cost basis | Status |
|---|---|---|---|---|
| **Stripe** | Collecting the Pro subscription | `STRIPE_SECRET_KEY` (Supabase secret) | Standard Stripe per-transaction fees | ⚠️ Secret was set to a placeholder — must be re-set with the real key before payments work |
| **Anthropic API** | AI value estimates (§1.4) — `claude-sonnet-5` + `web_search`; AI group-photo splitting (`split-photo`, plain vision call, cheaper) | `ANTHROPIC_API_KEY` (Supabase secret) | Per estimate: one Claude call **with web search** (pricier). Per split: one vision call. Both Pro-gated to cap spend. | ⚠️ Not set yet — both functions return `not_configured` until it is |
| **Supabase** | Postgres, Auth, private Storage, Edge Functions | project `xkzuoogmcfrxicmoybzp` (ca-central-1) | Plan tier + usage | Live |
| **Supabase custom auth domain** | `auth.inventoryourhouse.com` on the sign-in screen | domain add-on | ~$10/mo add-on | Live |
| **Resend** | Transactional email (invites, notifications, digest) | `RESEND_API_KEY` (Supabase secret) | Free tier / usage-based | Live — but only delivers to the owner's own address until `inventoryourhouse.com` is verified in Resend |
| **AWS Amplify + Route 53** | Web hosting + DNS for `inventoryourhouse.com` | Amplify app `d3mbyx420tjxzh` | Build minutes + hosting + hosted-zone fee | Live |

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
