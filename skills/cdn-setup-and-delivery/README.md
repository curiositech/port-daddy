# CDN Setup and Delivery

Architecture-level decisions for putting a CDN in front of a web application's
static assets, API responses, and file/media delivery: provider selection,
signed-URL / tokenized access, cache invalidation strategy, origin shield, and
CDN-layer geo-restriction.

## Structure

```
cdn-setup-and-delivery/
├── SKILL.md                                # Core process + decision tree + anti-patterns
├── CHANGELOG.md                            # Version history
├── README.md                               # This file
└── references/
    ├── provider-selection.md               # Hyperscaler vs. specialist $/GB cost model
    ├── signed-url-patterns.md              # HMAC/JWT signed-URL implementation sketches
    └── invalidation-and-shielding.md       # Versioned URLs, purge strategy, origin shield
```

## Quick Start

1. Read SKILL.md for the provider-selection decision tree and the two
   anti-patterns (app-server proxying, assuming purge is synchronous).
2. Pull a reference file only when you need the deeper mechanics:
   provider cost modeling, signed-URL code sketches, or purge/shield
   configuration detail.
3. See the SKILL.md frontmatter `pairs-with` list for the neighboring
   skills this one hands off to (`cdn-cache-control-headers`, `cloudflare`,
   `managed-video-streaming-pipeline`).

## Scope

This skill is intentionally generic and provider-agnostic — it is not tied
to any specific project or content vertical. It governs the *architectural*
decision of whether/how to put a CDN in front of something, not the syntax
of any one provider's dashboard or any one HTTP header.
