# Declutter — Product Spec (repo/project name: declutter)

> _"Swedish death cleaning, together."_ A household app where adult children and their
> parents photograph belongings, decide keep/toss/donate together, and quietly build a
> tagged, valued, story-rich inventory with heir assignments that can export to a
> legally-referenceable memorandum.

## Context

Families avoid the "what do we do with all this stuff?" conversation until a crisis —
a death, a dementia diagnosis, a forced downsizing — turns it into a nightmare. Declutter
converts that one unbearable conversation into hundreds of tiny 5-second decisions,
captured asynchronously and photo-first. The adult child is the motivated buyer; the
parent is the decision-maker and account owner. The app is really **two experiences on
one database**: a capable "organizer" UI for children, and a radically simple,
voice-first, swipe-based UI for parents.

**Decisions locked (from brainstorm):**
- **Positioning:** Declutter-first (act-now energy, trigger moments). Stories, heir
  assignment, and value are the *retention* layer beneath the triage hero.
- **Scope:** Full vision — the lean loop **plus** estate export, AI auto-tagging, AI
  value estimates, donation tax receipts, and legacy/executor access. Sequenced into
  phases below so it ships incrementally.
- **Platform:** Expo (React Native + Expo Web) → one codebase for iOS, Android, web.
- **Backend:** Supabase (Auth, Postgres + RLS, Storage w/ signed URLs, Edge Functions).

---

## 1. Users, roles & the core principle

**The parent is the account owner and sole authority.** Children are *contributors*.
This is the ethical spine (elder-abuse protection) and the liability shield. Every
keep/toss/donate and heir decision is the parent's; children can capture, suggest, and
request — never decide.

| Role | Can do | Cannot do |
|---|---|---|
| **Parent / Owner** | Everything: decide items, assign heirs, set visibility, manage members, export memorandum | — |
| **Child / Contributor** | Batch-photograph items, add notes, *request* an item, view what parent chooses to reveal | Decide items, see heir assignments (unless revealed), remove members |
| **Executor** (legacy) | Read-only unlock of the full inventory + memorandum, gated by a death/incapacity verification flow | Edit while owner is active |
| **Co-owner** (optional) | Spouse/partner with full owner rights on shared household | — |

A **Household** is the top-level tenant. All row-level security scopes to it.

---

## 2. The core loop (the whole product in one paragraph)

Child walks a room and **batch-captures** 30 items (fast, offline-tolerant). AI
auto-tags each ("china", "jewelry", "tools") and detects the room. Sets that belong
together — Dad's coins, the wine cellar — go into a **collection**: pin it once in
capture and every shot files itself in. Later, the parent opens a **swipe queue** on
the couch: right = keep, left = donate, down = toss, tap up = "tell me about this"
(voice note → transcribed). A collection arrives as **one card** — forty coins is one
decision, with an "open it up" escape hatch. Kept items flow into the **inventory**,
where value, heirs, and tags accrete over time. When ready, the parent exports a
**personal-property memorandum** to bring to their attorney. Donations generate
**tax-receipt records**. On death/incapacity, the **executor** unlocks it all.

---

## 3. Feature set (phased)

### Phase 1 — The Loop (prove parents engage)
- Household creation; invite child (parent-approved) / accept invite.
- **Batch camera capture** — rapid multi-shot, offline queue, later sync.
- **Swipe triage** for parents (keep / donate / toss / tell-me-more).
- Item detail: photos, free tags, **voice-note story → auto-transcript**, text note.
- Basic manual value field (market $ and a separate "sentimental" flag).
- Private storage, **server-side EXIF/GPS stripping**, signed-URL delivery.
- Passkey / biometric auth; parent-simplified UI mode.

### Collections (shipped Sep 2026)
Named item sets — "Coin collection", "Wine cellar", "Grandad's fishing gear" — for
things that are catalogued and decided as a set rather than one by one.

- **Organizational only.** Items keep their own decision, heir, story, and photos; a
  collection is a grouping, never an authority boundary. Deleting one un-groups its
  items (DB FK is `ON DELETE SET NULL`) — it never deletes them.
- **Any active member** may create collections, rename them, and file items in or out
  (same authority as rooms). Deciding stays with the deciders regardless of grouping.
- **Two add flows:** *en masse* — pin a collection in capture (sticky chip, both the
  native camera and web form; AI photo-split items inherit it) and every shot files
  itself in; *as you go* — a bulk-select "Collection…" action in inventory, and a
  "Part of…" picker on the item screen.
- **Decide queue collapse:** a collection's undecided items become one swipe card
  ("Coin collection · 45 items · one decision for all of them", with documented value
  and family-request badges). Escape hatches: "Look inside" (the collection screen)
  and "One by one" (per-session expansion). Undo restores the whole group.
- **Privacy:** a collection row uploads lazily — only when a synced item references
  it. A collection holding nothing but `localOnly` items never reaches the cloud,
  not even its name.
- Collection members are exempt from duplicate detection (forty near-identical coins
  are intentional, not re-photographs).
- Deferred: realtime on the collections table itself (membership already syncs live;
  new names arrive with the next pull), set-level valuation, collection-level heir
  assignment.

### Phase 2 — Estate layer (the paid hook)
- **Heir assignment** per item, with **parent-controlled visibility**
  (never / after I'm gone / reveal now).
- **"Request this item"** by children (interest signal, no competitor visibility).
- **Personal-property-memorandum PDF export** (formatted, signable, "take to your
  attorney", clear *not legal advice* disclaimer).
- Duplicate-item detection; item history/audit visible to owner.

### Phase 3 — Intelligence & exits
- **AI auto-tagging** (object → category, room detection) at capture.
- **AI value estimates** from sold-comps (eBay sold listings), labeled *market value*
  distinct from *sentimental value*.
- **Donation flow → tax-receipt-ready records** (IRS-style itemized).
- **Insurance export** ("document your home" on-ramp; same data, non-morbid framing).
- **Legacy/executor access protocol** (designated executor + verification; Apple Legacy
  Contact is the model).

---

## 4. Data model (Postgres / Supabase)

```
households
  id, name, created_by (auth uid), created_at

household_members
  id, household_id → households, user_id (auth uid),
  role enum('owner','co_owner','contributor','executor'),
  status enum('invited','active','revoked'),
  invited_by, invited_at, accepted_at

people                      -- heirs (may or may not be app users)
  id, household_id, display_name, relationship,
  linked_user_id (nullable auth uid), email (nullable)

collections                 -- named item sets ("Coin collection"); grouping only
  id, household_id, name, note,
  created_by, created_by_name, created_at, updated_at
  -- any-member RLS; delete un-groups (items FK is ON DELETE SET NULL);
  -- uploaded lazily so a set of localOnly items never reaches the cloud

items
  id, household_id, created_by,
  title, room, collection_id (nullable → collections),
  decision enum('undecided','keep','donate','toss'),
  decided_by, decided_at,
  market_value_cents (nullable), is_sentimental bool,
  value_source enum('manual','ai_comp'), note,
  is_duplicate_of (nullable → items), created_at, updated_at

item_photos
  id, item_id → items, storage_path (private bucket),
  width, height, exif_stripped bool, is_primary, created_at

item_tags
  item_id, tag         -- freeform + AI-suggested; PK(item_id, tag)

stories                     -- voice-first legacy
  id, item_id, storage_path (audio, nullable), transcript,
  created_by, created_at

heir_assignments
  id, item_id, person_id → people,
  visibility enum('owner_only','after_death','revealed'),
  assigned_by, assigned_at        -- owner-only writes (enforced by RLS)

item_requests               -- child expresses interest, no competitor visibility
  id, item_id, requested_by, message, status
  enum('open','acknowledged','granted','declined'), created_at

donations
  id, item_id, charity_name, donated_on,
  fair_market_value_cents, receipt_pdf_path

audit_log
  id, household_id, actor_user_id, action, target_type,
  target_id, metadata jsonb, created_at   -- surfaced to owner

legacy_access
  id, household_id, executor_user_id,
  status enum('designated','pending_verification','unlocked'),
  trigger enum('death','incapacity'), verified_by, verified_at
```

**Sensitive fields** (`market_value_cents`, `heir_assignments.*`) get field-level
encryption at rest. All tables carry RLS keyed on `household_id` + role.

---

## 5. Screen map

```
Onboarding
  Welcome → Role pick (I'm organizing a parent's home / I'm the parent) →
  Create or Join Household → Passkey setup → Invite family

CHILD (Organizer) tab bar:  [Capture] [Rooms] [Inventory] [Requests] [Family]
  Capture         batch camera, offline queue indicator, sticky Collection chip
  Rooms           grid of rooms → item thumbnails, decision status chips;
                  collections grid below the rooms
  Inventory       filter/search by tag/room/decision/heir/value; collection chip
                  strip; bulk-select incl. "Collection…"; item detail
  Item detail     photos, tags, story, value, "Part of <collection>" picker,
                  "Request this item"
  Collection      /collection/[id] — member grid, counts (+ value for deciders),
                  rename/note, "Add items" (deep-links into pinned capture),
                  delete (un-groups). Stack route, reached from Rooms/Inventory —
                  no tab of its own (the 375px five-label budget is spent)
  Requests        my requests + status
  Family          members, invites, roles

PARENT (Owner) tab bar:  [Decide] [Keepsakes] [Heirs] [Export]
  Decide          the swipe queue (hero); a collection's undecided items collapse
                  into one "WHOLE COLLECTION" card with Look-inside / One-by-one
  Keepsakes       kept items, big cards, add story / value
  Item detail     big text, voice buttons, heir picker, visibility toggle
  Heirs           people list; per-person "what they'll receive"; reveal controls
  Export          memorandum PDF, insurance export, donation receipts
  Settings        members, audit log, legacy/executor, security

Executor (post-unlock): read-only Inventory + Export
```

---

## 6. What the UI feels like (wireframes)

### Parent — Decide (the hero swipe screen)
Warm, huge, calm. One item at a time. No clutter, no counts that feel like a chore
(show progress as gentle "12 to go", not "247 remaining").

```
┌───────────────────────────────┐
│  Decide            ●●●○○  12 ↔ │
│                                │
│    ┌───────────────────────┐   │
│    │                       │   │
│    │      [ photo of       │   │
│    │        blue teapot ]  │   │
│    │                       │   │
│    └───────────────────────┘   │
│                                │
│        Blue china teapot       │
│        Kitchen · added by Sam  │
│                                │
│      ┌──────┐      ┌──────┐    │
│      │  🗑   │      │  💝  │    │  ← swipe L = donate, R = keep
│      │ Toss │      │ Keep │    │
│      └──────┘      └──────┘    │
│                                │
│      ⌄  Tell me about this  ⌄  │  ← tap = record voice story
└───────────────────────────────┘
```

### Parent — Item detail (voice-first, big targets, no typing)
```
┌───────────────────────────────┐
│ ‹ Back        Blue teapot   ⋯ │
│  ┌─────────────────────────┐   │
│  │      [ photo ]          │   │
│  └─────────────────────────┘   │
│  Kept ✓        Kitchen         │
│                                │
│  ▶  "My mother brought this    │
│      from Delft in 1962…"      │
│      [ 0:34 voice · transcript]│
│      ┌──────────────────────┐  │
│      │  🎙  Record a story   │  │
│      └──────────────────────┘  │
│                                │
│  Who gets this?                │
│      ┌──────────────────────┐  │
│      │  👤 Maya  (daughter)  ▾│  │
│      └──────────────────────┘  │
│      Visible:  ◉ Only me       │
│                ○ After I'm gone │
│                ○ Reveal now     │
│                                │
│  Value   $120  · ♡ sentimental │
└───────────────────────────────┘
```

### Child — Capture (fast batch, offline-aware)
```
┌───────────────────────────────┐
│  Kitchen ▾              ☁ 8 ↑ │  ← room context + sync queue badge
│                                │
│         [ live camera ]        │
│                                │
│   ▢ ▢ ▢ ▢  ← last shots strip  │
│                                │
│            (  ◉  )  shutter     │
│   AI: "looks like glassware"   │  ← inline auto-tag hint
│  ⚡ Batch mode — keep shooting  │
└───────────────────────────────┘
```

### Child — Inventory (the power UI: filter, search, scan)
```
┌───────────────────────────────┐
│ Inventory        🔍  ⚲ filter │
│ [Keep][Donate][Toss][Undecided]│
│ ─────────────────────────────  │
│ ▢ Teapot     Kitchen  Keep  💝 │
│   #china  →Maya   $120          │
│ ▢ Drill      Garage   Donate    │
│   #tools                        │
│ ▢ Ring       Bedroom  Keep  💝 │
│   #jewelry →Sam   $1,400  🔒    │  ← 🔒 heir hidden from siblings
│ …                              │
└───────────────────────────────┘
```

### Parent — Export
```
┌───────────────────────────────┐
│  Export & Peace of Mind        │
│  ┌──────────────────────────┐  │
│  │ 📄 Personal Property      │  │
│  │    Memorandum (PDF)       │  │
│  │  38 items · 6 heirs       │  │
│  │  [ Preview ]  [ Export ]  │  │
│  │  Not legal advice ·       │  │
│  │  take to your attorney    │  │
│  └──────────────────────────┘  │
│  ┌──────────────────────────┐  │
│  │ 🏠 Insurance inventory    │  │
│  │ 🧾 Donation tax receipts  │  │
│  └──────────────────────────┘  │
└───────────────────────────────┘
```

**Visual direction:** warm neutrals (cream, sage, muted terracotta) not clinical
white; large serif for item titles (heirloom warmth), humanist sans for UI; generous
spacing; parent mode ships bigger type + higher contrast + fewer controls by default.
Tone throughout: organizing and honoring, never "death admin."

---

## 7. Security architecture (this is a catalog of an elder's valuables — treat it that way)

- **EXIF/GPS stripped server-side** on every upload (Edge Function) before storage.
- Photos in **private buckets**; delivered only via **short-lived signed URLs**. No
  public links in v1 — not even opt-in.
- **RLS on every table**, keyed to `household_id` + role. `heir_assignments` writes are
  owner-only; contributor reads filtered by `visibility`.
- **Passkeys/biometric** as default auth; MFA on sensitive actions (export, member
  changes, heir edits). Elder-friendly recovery via **trusted recovery contacts**, not
  email-only.
- **Field-level encryption at rest** for values + heir assignments.
- **Audit log** of views/edits, surfaced to the owner (doubles as elder-abuse deterrent).
- **Legacy access protocol**: designated executor + death/incapacity verification before
  unlock; read-only.
- **Business model = subscription, never ads/data.** Stated loudly in-product as a
  feature. No third-party data sharing of inventory content.

---

## 8. Tech stack

- **Client:** Expo (React Native) + Expo Router; Expo Web for the browser build.
  `expo-camera` (batch capture), `expo-image-picker`, `expo-secure-store`,
  `expo-local-authentication` (biometric), offline queue via local SQLite/MMKV +
  background sync.
- **Backend:** Supabase — Auth (passkeys + OAuth), Postgres + RLS, Storage (private
  buckets + signed URLs), Edge Functions (Deno) for EXIF strip, AI tagging/valuation,
  PDF generation.
- **AI:** vision model for auto-tag/room detect; sold-comps lookup for value; Claude for
  transcript cleanup/summaries. All server-side behind Edge Functions (keys never on
  client) — mirrors the StockPulse market-wide-compute-once pattern where cacheable.
- **PDF:** server-side memorandum/receipt generation in an Edge Function.
- **Payments:** RevenueCat (cross-platform subscriptions across App Store / Play / web).

---

## 9. Build sequence

1. **Scaffold** Expo + Supabase; auth (passkey + OAuth); household + members + RLS.
2. **Phase 1 loop:** batch capture + offline sync → EXIF-strip pipeline → swipe triage →
   item detail with voice story. *Validate parents engage before proceeding.*
3. **Phase 2 estate:** heir assignment + visibility, item requests, memorandum PDF,
   audit log.
4. **Phase 3 intelligence:** AI tagging, AI valuation, donation receipts, insurance
   export, executor/legacy protocol.
5. Hardening: security review, elder-usability testing, App Store / Play submission.

---

## 10. Riskiest assumption & cheapest test (do this before/alongside Phase 1)

**Will parents actually engage, even with a perfect UX?** Cheapest test needs *no app*:
a shared photo album + weekly call with 3 real families. If parents won't decide
keep/toss/donate over photos with their own kids facilitating, no interface fixes it.
Run this in parallel with scaffolding.

---

## 11. Deliverable for this session

A **clickable HTML mockup artifact** of the hero screens (Parent Decide swipe, Item
detail, Child Capture, Inventory, Export) styled in the warm visual direction above — so
you can *see and feel* the UI, not just read wireframes. This spec file is the written
companion.

## Verification

This is a spec + mockup, not production code. "Verification" = the HTML mockup renders
the five hero screens, is navigable, and conveys the parent-vs-child UI split and the
warm/non-morbid tone. You review it and we iterate on flows/wording before any Expo code
is written.
