# CDN Setup and Delivery — Changelog

## v1.0.0 (2026-09-19)

- Initial skill creation.
- Core decision tree covering provider selection ($/GB heuristic), signed
  URL / tokenized access, cache invalidation strategy, origin shield, and
  CDN-layer geo-restriction.
- Two anti-patterns: proxying large files through the app server, and
  assuming purge is synchronous/global.
- Reference files: provider-selection.md (cost model + worked example),
  signed-url-patterns.md (HMAC/JWT implementation sketches), and
  invalidation-and-shielding.md (versioned-URL and origin-shield deep dive).
- Differentiated from cdn-cache-control-headers (HTTP header syntax) and
  cloudflare (single-provider product configuration); paired with
  managed-video-streaming-pipeline for video-specific delivery.
