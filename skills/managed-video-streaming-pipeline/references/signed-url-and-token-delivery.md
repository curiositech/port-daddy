# Signed / Tokenized Delivery URLs

Read this when implementing access control for "private" or paywalled video
delivered through a CDN, without building full DRM.

## Why this exists between "public URL" and "DRM"

A plain public CDN URL for a video rendition or manifest can be copied,
shared, and hotlinked by anyone who obtains it — there's no access control
beyond obscurity of the URL. Full DRM (see
`references/drm-and-watermarking.md`) solves this but at high implementation
cost and with real playback friction (licensed player required on every
client). Signed/tokenized URLs sit in between: they don't encrypt the stream
or require a special player, but they make a leaked or shared URL expire
quickly and, where the CDN supports it, bind it to the context it was issued
for.

## Core requirements

1. **Expire in minutes, not hours.** A signed URL valid for 24 hours is
   barely different from a permanent public URL for practical purposes —
   anyone who captures it during that window has full access for the
   remainder. Short expiry (5-15 minutes is typical for a single playback
   session, refreshed by the player as needed) limits the value of a leaked
   URL to a narrow window.
2. **Bind to context where practical.** Binding a signed URL to the
   requesting IP address, a referrer header, or a session/user identifier
   (where the CDN or storage provider supports it) prevents the URL from
   being usable outside the context it was issued for, even within its
   expiry window. Not all CDNs support all binding types — check what your
   specific provider offers before assuming IP-binding is available.
3. **Sign the manifest AND the segments for adaptive streaming.** For HLS/
   DASH delivery, a naive implementation signs only the top-level
   `.m3u8`/`.mpd` manifest URL, leaving the individual `.ts`/`.m4s` segment
   URLs referenced inside it unprotected or protected with a much longer
   expiry set at packaging time. Decide explicitly whether segment URLs need
   their own short-lived signing (higher security, more complexity) or
   whether manifest-level signing plus a moderately short segment expiry is
   an acceptable tradeoff for your threat model.
4. **Don't conflate this with authentication.** Signed URLs control *this
   specific request*, not *who the user is*. The signing step should happen
   after your normal auth/authorization check confirms the user is allowed
   to view this content — the signed URL is the delivery-layer enforcement
   of a decision your app already made, not a replacement for making it.

## Provider-specific patterns (verify current docs before implementing — these mechanisms evolve)

- **Cloudflare Stream / Cloudflare CDN Signed URLs**: Signed tokens attached
  as a query parameter, verified at the edge; supports expiry and can be
  combined with Cloudflare Access rules for additional binding.
- **AWS S3 presigned URLs / CloudFront signed URLs & cookies**: S3 presigned
  URLs grant time-limited access to a specific object; CloudFront signed
  URLs/cookies extend this to CDN-fronted delivery and support custom
  policies (expiry, IP range restriction).
- **Mux signed playback IDs**: Mux issues a signed JWT-based playback token
  per viewing session tied to a specific playback ID, with configurable
  expiry, rather than signing raw storage URLs.
- **BunnyCDN token authentication**: Token-based URL signing with expiry and
  optional IP binding, configured per pull zone.

## When signed URLs are NOT enough

If the actual requirement is "block this content from being copied and
redistributed as a file, not just from being hotlinked," signed URLs do not
meet that bar — a user who is legitimately viewing the content within a
valid signed-URL window can still download/save the segment files. That
requirement needs DRM. See `references/drm-and-watermarking.md` for the
decision between DRM and forensic watermarking once URL-level access control
alone isn't sufficient.
