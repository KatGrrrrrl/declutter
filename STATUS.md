# Status report — Inventory Our Home

Consolidated view of the **HomeInventory** session group: what is finished, and what is
still owed. Maintained by the *Status report agent* session.
`THREADS.md` stays the per-session tally; this file is the cross-thread answer to
"what's left, and who does it."

_Last updated: Sep 9, 2026 · `origin/main` = `1246269` · live bundle `ce789fad…` · working tree clean_

---

## 1. Thread roster (8 sessions in the group)

| # | Thread | Status | Carried forward |
|---|--------|--------|-----------------|
| 1 | Menu visibility on iPhone | ⚪ Idle | nothing |
| 2 | Mobile site logout | ✅ Retired | nothing |
| 3 | Default decider, sync e2e & presence | ✅ Retired | presence banner unproven on two real devices |
| 4 | Household inventory app (main) | ✅ Retired | Stripe probe; the Pro end-to-end pass; `landing/index.html` decision |
| 5 | Collections family grouping | ✅ Retired | nothing |
| 6 | Family admin controls & custom rooms | ⚪ Idle | `addHousehold` doesn't clear items/collections/rooms |
| 7 | Sign-in for existing house members | ⚪ Idle | live account-switch never tested with a second account |
| — | Status report agent (this one) | 🟢 Running | maintains this file |

Everything every thread wrote is committed, pushed, and deployed. No uncommitted feature
work exists anywhere in the tree.

---

## 2. What is done

**Shipped and verified live**
- Cloud sync v2 end to end: capture, edit, delete, archive, reconcile-on-connect, refresh
  on every load, and the "your backup is waiting" restore prompt.
- Collections, custom rooms with floors, household administrators, household
  rename/remove/delete-everywhere.
- Heir assignments and per-item main decider sync as their own RLS-hidden rows.
- Photo retry: uploads that never reached the family now catch up on connect.
- Invite decline, plus the declined-invite email.
- Sign-in identifies the person rather than the device; a second account's local state is
  parked, not wiped.
- Mobile Account tab so log out is reachable anywhere; Family tab "+" and per-family cards.
- Free sync, Pro equals AI only, with every stale piece of copy corrected.
- Daily digest live on `pg_cron` at 23:00 UTC.
- Email sends as `hello@inventoryourhouse.com` with SPF, DKIM and DMARC passing.
- Migrations `0009` through `0015` applied; ten edge functions deployed.
- Docs rewritten to match the code: `HANDOFF.md`, `AGENTS.md`, `GO-LIVE.md`, `PRICING.md`.
- Database wiped clean Sep 8; the phone re-onboarded a fresh Millrun and the desktop
  restored it.

---

## 3. What to do

### 🔴 Launch blockers

1. **Re-run the Stripe probe.** The key was a literal placeholder on Sep 7, so checkout
   returned 500 and nobody could subscribe. A test key was set but never re-verified.
   Want `status: 200` and a `checkout.stripe.com` URL.
   ```
   $env:SERVICE_KEY="<service_role>"; node tools/probe-checkout.mjs
   ```
2. **Exercise the paid product once, by hand.** No one has ever run a live AI value
   estimate or a group-photo split on a Pro household. This is the entire thing Pro sells.
   Grant Pro to Millrun, try both features, then revert with `--free`.
3. **Swap in the live Stripe key** and make one real purchase, then refund it.
   GO-LIVE §0 and §1 blocker 1.
4. **Revert every hand-granted Pro household** before opening up. GO-LIVE §1 blocker 4.
5. **Custom SMTP.** Sign-in codes and member invites still go through Supabase's built-in
   mailer, capped at a few sends an hour. That is the first email an invited child gets.

### 🟠 Verification owed

6. Live account switch: sign in as a second account on a device that already holds another
   household. Thread 7 shipped the fix but could not test it.
7. Presence banner with two real signed-in devices. Only the transport was proven.
8. Two-user e2e script. Written against pre-Collections row shapes and never executed, so
   check its row builders against current `sync.ts` first.
9. Email delivery to someone other than the Resend account owner, and spam placement. The
   first real family invite settles it.
10. Finish the post-wipe sequence on the phone: two remaining invites, and re-photograph
    the second painting.

### 🟡 Known bugs, unfixed

11. `addHousehold` leaves the previous home's items, collections and rooms on screen until
    the cloud replaces them.
12. React hydration mismatch fires four times per page load in production. Nothing looks
    broken, but the pre-render is discarded every time. Needs a product call between a
    `mounted` gate and `web.output: "single"`.
13. `item_messages` realtime has no household filter, so messages for items not yet pulled
    are silently dropped. Needs a `household_id` column.
14. The sign-in error path shows the form to an already-signed-in user with no way out.
15. Writes that fail to mirror are invisible to the device that made them. Photos had this
    shape and were fixed; heirs and main decider still have it.
16. Two orphaned storage objects under a deleted household are unreachable but billed.
    Deleting them needs the user's say-so.

### ⚪ Decisions waiting on the user

17. `landing/index.html` is never built or served. Wire it up as the public front door, or
    delete it.
18. Privacy policy. Settings still says "coming soon", and Stripe and the app stores
    generally require one.
19. Support address is decided but not surfaced. Put `hello@inventoryourhouse.com` in
    Settings and on the Pro card.
20. Whether to keep several sessions editing `store.ts`, `sync.ts` and `realtime.ts` at
    once. One commit already swept another thread's work into `main`.

### 🔵 Cleanups, not urgent

21. Derive the synced-column list from the row type so the compiler catches a missed column.
22. Memoize the repeated collection upsert during a photo sweep.
23. Roughly sixty `Pressable`s still have no accessible name; a shared component plus a lint
    rule would stop it recurring.
24. Consider the newer Anthropic web-search tool version in the value estimator, after
    checking current docs.
25. Replace the placeholder Expo app icons, move the Google OAuth client to its own project,
    and test Google sign-in on the custom domain.

---

## 4. Not on the critical path

iOS and Android are not submitted, blocked on Apple Developer enrollment. The web launch
does not depend on it.
