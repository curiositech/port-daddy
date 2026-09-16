# Local-Only Mode and the Data-Boundary Consent Screen

Use this when you need the mechanics of "local-only no-account path," the data-boundary consent screen, or
proving a "local-only mode uploads nothing" claim is real rather than asserted.

## Where this comes from

The Agent Harbor binder sets two commitments that this reference exists to keep honest:

- **00-prd**: "Local transcripts saved by default. Cloud sync is separate and opt-in." Local is the default
  state, not a fallback mode bolted on after the cloud path shipped.
- **07-milestones M3**: "local-only no-account path; optional passkey sign-in; device pairing... explicit
  data-boundary screen." Three separate commitments in one sentence — a path that needs no account, a sign-in
  method that is optional rather than critical, and a screen that makes the local/cloud boundary visible
  and explicit rather than implicit.
- **07-milestones M10**: "...verify local-only mode uploads nothing." Not "document that it uploads nothing" —
  *verify*.

## Local-only path: what "has one" actually means

A feature "has a local-only path" only if a user who never creates an account and never pairs a device can
still use it (possibly a reduced version of it) with zero cloud dependency. Common ways this claim turns out
to be false in practice, all caught by `identity-gated-no-local-path`:

- The local path exists in the onboarding flow but the feature itself silently requires a background sync
  call the first time it's used for real.
- "Local-only" was true at the demo and became false the moment telemetry, crash reporting, or a
  license-check call was added later without re-auditing the feature.
- The local path is real but gated behind a feature flag that's off by default, so in practice zero users can
  reach it — a local path that ships dark is not a local path.

The fix is not a policy statement ("we support local-only") — it's an entry in the feature inventory
(`hasLocalOnlyPath: true`) that a reviewer can trace to a code path that never touches the network, plus a
test that exercises it with no credentials and no network access.

## The data-boundary consent screen

A "tier crossing" is any moment a user's data moves from the private/local tier into `repo`, `team`, or
`public` scope (see `references/scope-ladder-and-tenancy-roles.md` for the tiers themselves). M3 requires an
**explicit** screen at that moment — not a settings toggle a user might have flipped six months ago, not a
one-time onboarding checkbox that silently governs every future crossing.

What makes a consent screen "explicit" enough to satisfy `crossesTierWithConsentScreen: true`:

1. It appears **at the moment of the crossing**, not earlier (onboarding) or never (a background default).
2. It **names the destination tier** and what becomes visible to whom (e.g. "this will be visible to your
   team" vs. "this will be published publicly" are different screens with different stakes).
3. It requires an **affirmative action** — not a screen the user can dismiss without reading, and never a
   crossing that proceeds on a timeout or a default "yes."
4. It is **per-crossing, not per-account** — a user who already crossed into `repo` scope once still sees the
   screen the first time a *different* feature crosses into `team` or `public` scope, because the stakes
   differ per tier.

A feature that silently defaults to a wider tier ("sync to team by default, no prompt") is exactly the
`tier-crossing-no-consent` failure mode, even if the feature is otherwise well-built.

## Making "uploads nothing" provable, not asserted

M10's "verify local-only mode uploads nothing" is the harder half of this reference. A doc comment or a
product-page claim is not verification. What is:

- A test that runs the local-only code path with the network stack replaced by a socket that throws on any
  connection attempt, and asserts zero throws.
- A CI job that runs the app in local-only mode inside a network namespace with egress blocked, and asserts
  the app still completes its core task (proving the block didn't just silently break the feature).
- An egress audit log that is empty after a scripted local-only session, checked in CI, not read manually
  before a release.

Any of these make `localOnlyMode.uploadsNothingTestable: true` true in a way a reviewer can independently
reproduce. Without one of them, the claim is unfalsifiable, and `tenancy_boundary_audit.mjs` treats
unfalsifiable as unsafe — see `local-mode-uploads-not-testable` in `SKILL.md`.
