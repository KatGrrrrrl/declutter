# Photo delivery — renditions, viewing size, and the HD original

_Written Sep 15, 2026. A decision record: what we serve, at what size, from where, and
how someone reaches the full-resolution photo. Companion to `TASKS.md` §9, which carries
the implementable tasks._

**Recommendation in one line:** stay on Supabase Storage, and replace the single stored
rendition with a **three-rung ladder — thumb / view / HD original — all under the existing
`{household_id}/{item_id}/` prefix**, so lists cost ~20 KB a row, detail screens cost what
they cost today, and the untouched original is always one deliberate tap away.

---

## 1. What exists today

| Fact | Where |
|---|---|
| Camera and library both capture at **quality 0.7** — already lossy before upload | `capture.tsx:223`, `photo-sync.ts:37` |
| `upload-photo` downscales anything wider than **1600 px**, re-encodes **q80**, stores **one** object | `upload-photo/index.ts:27,95` |
| **The original is discarded.** The full-resolution bytes exist only in the `bytes` local and are never uploaded | `upload-photo/index.ts:85–100` |
| Reads are signed URLs against that one object, cached in memory for a 1 h TTL | `photo-sync.ts:23,165` |
| 56 px and 52 px thumbs therefore pull the full ~250 KB image | `inventory-view.tsx:1044`, `split-review.tsx:157` |
| `split-photo` crops its items **out of the 1600 px rendition** — a shelf of eight yields ~300 px crops | `split-photo/index.ts:185–195` |
| No `cacheControl` is set on upload, so objects carry Supabase's 1 h default | `upload-photo/index.ts:112` |

> **Consequence worth stating plainly: there are no HD originals to go back to.** Every
> photo captured so far exists only as a 1600 px q80 derivative of an already-q70 capture.
> "An option to get to the HD original" is only true for photos taken **after** this change
> ships. Nothing in this design can recover what was already thrown away.

## 2. Why Supabase Storage stays the host

The decisive detail is in the Phase-1 migration: the bucket's SELECT policy authorizes on
the **first path segment**, the household id —

```sql
create policy "item_photos_bucket_select_member" on storage.objects
  for select to authenticated
  using (bucket_id = 'item-photos'
         and private.is_household_member(((storage.foldername(name))[1])::uuid));
```

So **any number of renditions under `{household_id}/{item_id}/` are already authorized by
the policy we have.** A rendition ladder needs no RLS change, no new authorization code,
and no second security boundary to keep correct — `createSignedUrl` keeps being the thing
that says yes or no, and it keeps saying it from the same membership check as everything
else in the app. The bucket's 20 MB per-object limit already accommodates an HD original.

Moving photos to an S3 host (Hetzner, R2, B2) means minting presigned URLs ourselves,
which moves that membership check into an Edge Function we would have to write and get
right, for a photographed catalog of an elder's home. That is the wrong trade at this
stage — see `TASKS.md` §9.5 for the cost numbers and the case for revisiting it later.

## 3. The ladder

Three objects per photo, same prefix, immutable paths:

| Rung | Path suffix | Size | Quality | Typical bytes | Used by |
|---|---|---|---|---|---|
| **thumb** | `{uuid}_t.jpg` | 400 px longest edge | q70 | ~20–30 KB | inventory rows, collection grids, capture strip, split review |
| **view** | `{uuid}.jpg` | 1600 px longest edge | q80 | ~200–300 KB | item detail, swipe card, `estimate-value`, `split-photo` |
| **HD** | `{uuid}_hd.jpg` | up to 2400 px longest edge | q88 | ~0.7–1.5 MB | nothing automatic — only "View full size" / "Download" |

**The view rung deliberately keeps the current path and current parameters.** Existing rows
keep working untouched, the diff stays small, and nothing about the detail screen changes.

**Schema:** two nullable columns on `item_photos` — `thumb_path text` and `hd_path text`.
Null means "this photo predates the ladder", and every read falls back to `storage_path`.
That fallback is what makes the backfill non-blocking.

**Why 2400 px and not "the original"** (decided by the user, Sep 15). An unbounded original
means unbounded upload time on a parent's phone and unbounded decode cost in the Edge
Function, for detail nobody looks at: 2400 px is ~2.25× the pixels we keep today, enough to
read a hallmark or a signature, and it keeps the HD rung near 1 MB rather than several. If
someone later wants true camera-original bytes, that is a different feature (an archival
tier) and should be argued separately.

Note this makes the ladder's rungs close together — 2400 against a 1600 view. That is fine
and intended: the view rung's job is to load fast on a detail screen, the HD rung's is to be
there when someone pinches in. It does mean the HD rung is worth roughly 1 MB of storage per
photo, not several, which is the cheap end of this decision.

## 4. How the bytes get there

The client sends **one** payload; the Edge Function derives all three rungs from it. One
request, one authorization check, one round trip, and — critically — **every rung is
re-encoded from decoded pixels, so the EXIF/GPS guarantee holds for all three.** Letting the
client produce renditions would break that guarantee, which is the whole reason
`upload-photo` exists.

Changes this implies:

1. **Capture at a higher quality.** `quality: 0.7` → `0.9` in `capture.tsx:223` and
   `photo-sync.ts:37`. Capturing at 0.7 and then calling the result "HD" would be a lie.
2. **Raise the payload ceiling.** `MAX_BASE64_CHARS` 8 MB → ~12 MB, still under the bucket's
   20 MB object limit.
3. **Decode once, resize down the ladder.** Encode HD first, then `resize` to 1600 and
   encode, then `resize` to 400 and encode. Three encodes of one decode.
4. **Set `cacheControl: '31536000, immutable'` on every upload.** The paths are uuid-based
   and never rewritten, so the bytes are immutable by construction; today they carry
   Supabase's 1 h default for no reason.

> **The one real risk to measure before committing:** `imagescript` is pure TypeScript, and
> decoding a ~12 MP JPEG plus three encodes may exceed the Edge Function's CPU or memory
> budget. Measure it on a real phone photo **before** building the rest. If it is too slow,
> the fallback is to encode thumb + view synchronously and produce HD lazily on first
> request — the ladder's shape does not change, only when the HD rung is filled.

## 5. How the bytes come back

- **Default everywhere is the smallest rung that fits the surface.** Lists and grids read
  `thumb_path`; detail screens read `storage_path`. `useSignedPhotoUrl` takes the rung it
  wants rather than assuming one path.
- **HD is never fetched implicitly.** It appears only behind an explicit "View full size"
  control on the item screen, which signs `hd_path` on tap. A photo nobody asks for at full
  size costs nothing to serve.
- **Egress beyond the ladder — raise the signed-URL TTL and persist the cache.** Every
  signed URL carries a unique token, so re-signing hourly produces a *new URL* and defeats
  both the CDN and `expo-image`'s disk cache: the same photo is re-downloaded every hour on
  every device. Since the objects are immutable, a much longer TTL (days, not an hour) plus
  persisting `urlCache` across reloads turns repeat views into cache hits. On a catalog
  people browse repeatedly this is plausibly a larger saving than the thumbnails, and it is
  a smaller change.
- **Weigh the TTL against the posture.** A signed URL is a bearer token: a longer life means
  a leaked link works longer. Days is a reasonable trade for immutable photos behind a
  membership check; "no expiry" is not. State the chosen number in `SPEC.md` §security.

## 6. Alternatives considered

| Option | Why not |
|---|---|
| **Supabase image transformations** (`createSignedUrl(..., { transform })`) | No schema change and no backfill, and it would work. But it needs the Pro plan and bills **$5 per 1,000 origin images**, forever, for something three lines of `imagescript` do once at upload. Its real advantage — arbitrary sizes on demand — is not something this app needs; there are exactly three surfaces. |
| **Cloudflare Images / R2 + Workers** | $0 egress is genuinely attractive at scale. Costs a second authorization implementation in a Worker and a second place where the "who may see this photo" rule lives. Revisit only if egress becomes a real line item. |
| **imgproxy on a small VPS in front of the bucket** | The strongest "later" option — it keeps Supabase as the store and adds derivatives at the edge. Still a service to run, patch and monitor for a product with no photo bill yet. |
| **Client-side rendition generation** | Fastest to build, and it breaks the EXIF-stripping guarantee that `upload-photo` exists to provide. Non-starter. |
| **Keep one size, serve it everywhere** | What we do now. Costs ~10 MB of egress to render a 40-row list of postage stamps, and leaves no path to an HD original at all. |

## 7. Order of work

1. Measure `imagescript` decode + three encodes on a real 12 MP photo (§4 risk). Everything
   below assumes it passes.
2. Migration: `thumb_path`, `hd_path` on `item_photos`.
3. `upload-photo`: capture quality up, ceiling up, ladder generated, `cacheControl` set.
4. Reads: `useSignedPhotoUrl` takes a rung; lists and grids switch to `thumb_path` with a
   `storage_path` fallback.
5. "View full size" on the item screen, signing `hd_path`, hidden when it is null.
6. Longer signed-URL TTL + persisted URL cache (independent of 2–5; ship whenever).
7. Backfill thumbs for existing rows. There is nothing to backfill for HD — §1.
