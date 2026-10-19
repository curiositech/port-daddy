# Cache Invalidation and Origin Shield — Deep Dive

Read this when designing a purge strategy, planning a versioned-URL rollout,
or configuring origin shield for a specific provider.

## Versioned URLs: the default for immutable content

Any asset that is fully replaced (not edited in place) on each publish should
get a content hash or version identifier baked into its URL:

```
/assets/app.js              -> /assets/app.a1b2c3d4.js
/images/hero.png            -> /images/hero.9f8e7d6c.png
/downloads/report-v1.pdf    -> /downloads/report-2026-09-19-8f3a.pdf
```

Build tooling (webpack, Vite, esbuild, etc.) does this automatically for JS/CSS
bundles via content-hash filenames. Apply the same discipline manually to any
other "replace the whole file on publish" content: generated PDFs, exported
reports, compiled media.

**Why this fully sidesteps the invalidation problem**: a new version is a new
URL. There is no cache entry to purge because the old URL still correctly
points at the old (still valid, still cached) content, and the new URL is a
guaranteed cache miss the first time anyone requests it, then cached
indefinitely (set a long `max-age`/`immutable` directive — see
`cdn-cache-control-headers` for the exact header syntax). Old, orphaned
versions age out via normal cache eviction or a periodic storage-lifecycle
cleanup — never via an active purge call.

**HTML entry points are the exception**: the page that *references* the
hashed asset URLs (typically `index.html` or a server-rendered template) is
itself mutable — it must be re-fetched on every deploy so it points at the
new hashes. Cache that with a short TTL or `no-cache` (revalidate every time),
never with the same long-lived `immutable` treatment as the hashed assets it
points to.

## When purge is unavoidable

Genuinely mutable content at a stable URL — a user's profile photo at
`/avatars/user-123.jpg`, a CMS page at `/blog/my-post`, an API response
cached at a fixed endpoint — cannot use the versioned-URL trick without
also changing every place that URL is referenced (often infeasible, e.g.
user-facing bookmarks or external links). For this content:

1. Call the provider's purge/invalidation API for the specific path (or a
   path pattern / tag / surrogate key, if the provider supports tag-based
   purging — see `cdn-cache-control-headers` for surrogate-key mechanics).
2. **Do not assume synchronous, global effect.** Purge propagation across
   edge POPs typically completes within seconds to low tens of seconds for
   major providers, but the purge API responding with success only means
   the purge was *accepted*, not that every POP has already dropped the
   stale entry.
3. Design the surrounding product/UX to tolerate that staleness window:
   - Show a "changes may take a minute to appear everywhere" notice for
     user-facing publish actions where it matters.
   - Avoid building logic (e.g. a test that asserts new content is
     immediately visible from a fresh purge call) that assumes purge
     is synchronous — this produces flaky tests and false incident alarms.
4. Batch purges where possible rather than firing one purge call per
   changed object during a bulk update — most CDNs charge per purge call
   or rate-limit purge APIs, and it's cheaper/faster to purge a shared
   parent path or tag once.

## Origin shield / tiered caching

**Problem it solves**: A CDN with, say, 300 edge POPs worldwide will, for a
long-tail object almost nobody requests, see up to 300 independent cache
misses — one per POP that happens to get a request for that object — each of
which goes all the way back to the origin. For rarely-accessed content (deep
archive video, infrequently downloaded files), this multiplies origin load
far beyond what the actual request volume would suggest.

**How it works**: Configure a single mid-tier cache layer (the "shield," often
a specific, larger regional POP) that all edge POPs are required to route
through on a miss, instead of hitting the origin directly. The shield caches
the object after its first fetch from origin; all subsequent edge-POP misses
for that object anywhere in the world are served by the shield, not the
origin. This turns "up to N origin hits" into "at most 1 origin hit," where N
is the number of edge POPs.

**When to configure it**:
- Long-tail media libraries (video archives, large file repositories) where
  most objects are rarely requested and cache hit rates per-POP are low.
- Any origin that shows request-volume spikes disproportionate to actual
  unique-object traffic (a sign that the same object is being re-fetched
  from origin by many different POPs).
- NOT needed for small, universally-hot content sets (a handful of assets
  requested constantly from everywhere) — those already get a high natural
  hit rate at every edge POP without a shield.

**Configuration note**: This is a standard checkbox/config option on most
major CDNs (sometimes called "origin shield," "tiered cache," or "shield
POP" depending on the vendor) — verify the exact setting name and any
regional-placement options in the provider's current docs rather than
assuming it's on by default.

## Quick reference: which mechanism for which content

| Content type | Mechanism |
|---|---|
| Compiled JS/CSS bundles | Content-hash filename, `immutable` cache header |
| Generated reports/exports | Version/timestamp in filename, long TTL |
| User avatar at stable URL | Explicit purge on upload, short-to-medium TTL as fallback |
| CMS page content | Explicit purge (or tag-based) on publish, tolerate staleness window |
| Long-tail video/file archive | Origin shield + normal TTL, no purge needed if content is immutable once uploaded |
| HTML entry point referencing hashed assets | Short TTL / `no-cache`, revalidate every request |
