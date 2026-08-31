# Example Output: Local-First Tenancy Boundary

Scenario: a team ships a "team harbor" collaboration feature straight to the cloud with no local-only
fallback, a "sync to public gallery" feature with no consent screen, an internal contradiction on an
offline-notes feature, an unfalsifiable "local-only mode uploads nothing" marketing claim, no export/delete
work, and a scope ladder that was never declared in order. This is the "bad spec" `tenancy_boundary_audit.mjs`
is designed to catch.

## Bad spec — input

```json
{
  "features": [
    {
      "name": "cloud-only-team-dashboard",
      "requiresIdentity": true,
      "hasLocalOnlyPath": false,
      "scopeTier": "team",
      "crossesTierWithConsentScreen": false
    },
    {
      "name": "auto-sync-to-public-gallery",
      "requiresIdentity": true,
      "hasLocalOnlyPath": true,
      "scopeTier": "public",
      "crossesTierWithConsentScreen": false
    },
    {
      "name": "offline-notes",
      "requiresIdentity": false,
      "hasLocalOnlyPath": true,
      "scopeTier": "private",
      "crossesTierWithConsentScreen": true
    }
  ],
  "localOnlyMode": { "uploadsNothingTestable": false },
  "exportDelete": { "perTierSupported": false },
  "scopeLadderOrdered": false
}
```

## Bad spec — audit result

```json
{
  "pass": false,
  "score": 26,
  "findings": [
    { "severity": "critical", "id": "identity-gated-no-local-path", "message": "Feature \"cloud-only-team-dashboard\" requires identity and has no local-only path — account/passkey sign-in is critical, not optional." },
    { "severity": "critical", "id": "tier-crossing-no-consent", "message": "Feature \"cloud-only-team-dashboard\" moves data to scope tier \"team\" with no explicit data-boundary consent screen." },
    { "severity": "critical", "id": "tier-crossing-no-consent", "message": "Feature \"auto-sync-to-public-gallery\" moves data to scope tier \"public\" with no explicit data-boundary consent screen." },
    { "severity": "low", "id": "private-tier-flagged-as-crossing", "message": "Feature \"offline-notes\" is scoped \"private\" but is also marked as crossing a tier with a consent screen — contradictory configuration." },
    { "severity": "critical", "id": "local-mode-uploads-not-testable", "message": "localOnlyMode.uploadsNothingTestable is false — the \"local-only mode uploads nothing\" claim has no runtime-verifiable check behind it." },
    { "severity": "critical", "id": "no-export-delete-per-tier", "message": "exportDelete.perTierSupported is false — export and delete controls are not proven to work for every scope tier data can land in." },
    { "severity": "critical", "id": "scope-ladder-unordered", "message": "scopeLadderOrdered is false — the private -> repo -> team -> public scope ladder is not declared as a single ordered source of truth." }
  ],
  "recommendations": [
    "Ship \"cloud-only-team-dashboard\" with a working local-only equivalent, or drop it from the identity-gated surface until one exists.",
    "Add an explicit consent screen that fires before \"cloud-only-team-dashboard\" first crosses out of the private/local tier into \"team\".",
    "Add an explicit consent screen that fires before \"auto-sync-to-public-gallery\" first crosses out of the private/local tier into \"public\".",
    "Confirm \"offline-notes\"'s real scope tier: either it stays private (drop the consent-screen flag) or it actually crosses tiers (set scopeTier to the real destination).",
    "Add a runtime-testable guarantee (e.g. a network-egress assertion or blocked-socket test) that proves local-only mode makes zero outbound calls.",
    "Implement and verify export/delete for every scope tier in play (private, repo, team, public) before shipping account/tenancy features.",
    "Declare the scope ladder once, in order (private, repo, team, public), and have every role/consent check derive from that single ordering instead of re-deriving it ad hoc."
  ]
}
```

## What fixing it actually looked like

1. **Built a local-only equivalent for the team dashboard.** `cloud-only-team-dashboard` became a feature with a real solo/offline mode — a user can decline the team invite and keep using a reduced local dashboard instead of being forced into an account.
2. **Added a data-boundary consent screen** on both `cloud-only-team-dashboard` and `auto-sync-to-public-gallery` that fires the first time either feature's data would leave the private/local tier — an explicit "this will be visible to your team" / "this will be published publicly" screen the user must affirmatively pass.
3. **Fixed the `offline-notes` contradiction** by clearing its stray `crossesTierWithConsentScreen: true` flag — it never leaves the device, so it needs no consent screen and shouldn't claim one.
4. **Made the "uploads nothing" claim testable.** Local-only mode now ships with a network-egress assertion in the test suite that fails the build if local-only mode makes any outbound call.
5. **Implemented export/delete for every tier** — private, repo, team, and public — and verified each path in an integration test before flipping `exportDelete.perTierSupported` to `true`.
6. **Declared the scope ladder once**, in order (`private`, `repo`, `team`, `public`), as the single source every role and consent check now derives from, instead of re-deriving the ordering ad hoc per feature.

## Fixed spec — input

This is `examples/sample-input.json`, unmodified:

```json
{
  "features": [
    { "name": "skill-authoring-local", "requiresIdentity": false, "hasLocalOnlyPath": true, "scopeTier": "private", "crossesTierWithConsentScreen": false },
    { "name": "passkey-sign-in", "requiresIdentity": true, "hasLocalOnlyPath": true, "scopeTier": "private", "crossesTierWithConsentScreen": false },
    { "name": "repo-skill-publish", "requiresIdentity": true, "hasLocalOnlyPath": true, "scopeTier": "repo", "crossesTierWithConsentScreen": true },
    { "name": "team-harbor-invite", "requiresIdentity": true, "hasLocalOnlyPath": true, "scopeTier": "team", "crossesTierWithConsentScreen": true },
    { "name": "public-skill-gallery-listing", "requiresIdentity": true, "hasLocalOnlyPath": true, "scopeTier": "public", "crossesTierWithConsentScreen": true }
  ],
  "localOnlyMode": { "uploadsNothingTestable": true },
  "exportDelete": { "perTierSupported": true },
  "scopeLadderOrdered": true
}
```

## Fixed spec — audit result

```json
{
  "pass": true,
  "score": 100,
  "findings": [],
  "recommendations": [
    "Tenancy boundary meets the bar: every identity-gated feature has a local-only path, every tier crossing shows consent, local-only mode is provably upload-free, export/delete works per tier, and the scope ladder is ordered."
  ]
}
```

## Edge case: an empty feature list is not "safe"

A spec that declares zero features but claims every other control is green still fails — an unverified inventory
is not proof of anything:

```json
{
  "features": [],
  "localOnlyMode": { "uploadsNothingTestable": true },
  "exportDelete": { "perTierSupported": true },
  "scopeLadderOrdered": true
}
```

```json
{
  "pass": false,
  "score": 88,
  "findings": [
    { "severity": "critical", "id": "no-features-declared", "message": "features[] is empty — no feature has been verified to have a local-only path, a consent screen, or a safe scope tier." }
  ],
  "recommendations": [
    "Enumerate every user-facing feature with its requiresIdentity, hasLocalOnlyPath, scopeTier, and crossesTierWithConsentScreen fields before claiming this boundary is safe."
  ]
}
```
