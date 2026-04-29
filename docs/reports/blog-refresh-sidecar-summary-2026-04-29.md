# Blog Refresh Sidecar Summary - 2026-04-29

Scope: `website-v2` `/blog` index, article pages, blog metadata, generated blog imagery, and blog validation.

## Agents Launched

- Brainstorming sidecar: proposed a current product-truth article slate centered on Fleet Control Center, backend readiness, local event loops, provenance, and coordination policy.
- Deprecation sidecar: recommended retiring future-dated and stale articles from the public index while keeping old slugs redirected to current replacements.
- Writing sidecar: drafted current posts around the recent work in this repo and identified the strongest article themes.
- Editing/design sidecar: pushed the blog toward flat Swiss-modern editorial layout, square borders, centralized hero metadata, and visible retired-thread handling.
- Image sidecar: generated visual directions for new Nano Banana assets and rejected the prior metaphor set.

## Response Reconciliation

- Centralize hero metadata: implemented with `heroImage` and `heroAlt` on `BlogPost`; page rendering and SEO now consume post metadata instead of local hero maps.
- Hide future-dated and stale articles: implemented with `deprecatedBlogPosts`, retired-thread display, replacement links, noindex metadata, and old-slug redirects.
- Replace the article slate: implemented with current posts for the control plane, fleet cold start, PD Tube, telemetry, map truth, daemon provenance, backend readiness, and Coordination Guard.
- Remove maritime/soft UI: implemented by removing old icon imports, rounded blog surfaces, ambient effects, hover image scaling, and local marketing-terminal blocks.
- Prove design contracts: implemented focused tests for generated hero existence, current dates, deprecated canonical targets, and blog flatness/square regressions.
- Preserve sidecar provenance without committing stale drafts: replaced the rough prompt/draft reports with this final summary after the implementation changed shape.

## Final Blog Slate

- The Control Plane Is the Product
- Fleet Designer Is the Cold Start
- PD Tube Makes Agents Reply to Events
- Telemetry Is a Launch Gate
- Cartographer and Navigator Keep the Map Honest
- Running Is Not Current
- Backend Readiness Is Dependency Truth
- Coordination Guard Turns Claims Into Policy

## Deprecation Decision

The public index now shows only current posts dated on or before 2026-04-29. Retired articles are listed as retired threads with replacement links, and old slugs redirect to their current replacements with noindex metadata.

## Visual Direction

The blog moved to flat Swiss-modern editorial composition:

- square image frames and article containers
- strict grid, high contrast type, and restrained color
- no rounded article cards, no decorative relief, no hover zoom
- generated abstract systems images instead of metaphor-driven hero art
- centralized `heroImage` and `heroAlt` on each `BlogPost`

## Generated Assets

Final generated assets live under `website-v2/public/img/generated/` as JPG and WebP pairs:

- `blog-control-plane-product`
- `blog-fleet-designer-cold-start`
- `blog-pd-tube-event-reply`
- `blog-telemetry-launch-gate`
- `blog-map-truth`
- `blog-daemon-provenance`
- `blog-backend-readiness`
- `blog-coordination-guard-policy`

The generator default was updated to the current Gemini image model for fast runs, while the final checked-in blog images were generated with the higher-quality preview model and recorded in the generated asset manifest.

## Proof Notes

- `/blog` now visibly identifies itself as "Port Daddy Blog".
- Blog article terminal blocks now override the global transparent `pre` rule and render with dark, high-contrast code surfaces.
- The screenshot proof was recaptured after waiting for real route content instead of the lazy loading fallback.
