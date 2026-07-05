# Tenancy Boundary Design Doc Template

Fill in every section before shipping an account/tenancy feature. Validate the underlying spec with
`node scripts/tenancy_boundary_audit.mjs --input <this-spec-as-json>.json` before marking it ready.

```markdown
## Feature Inventory

| Feature | Requires Identity | Has Local-Only Path | Scope Tier | Consent Screen on Crossing |
| --- | --- | --- | --- | --- |
| <name> | yes/no | yes/no | private/repo/team/public | yes/no/n-a (private) |

## Local-Only Mode

- Claim: "local-only mode uploads nothing."
- Runtime-testable proof: <link to the test/assertion that fails the build if local-only mode makes an outbound call>
- `localOnlyMode.uploadsNothingTestable`: <true/false — must be true before ship>

## Data-Boundary Consent Screens

For every feature whose Scope Tier is repo/team/public:

- <feature>: consent screen copy + link to the screenshot/flow it fires in, before the first byte crosses.

## Export / Delete Matrix

| Scope Tier | Export Implemented | Delete Implemented | Verified How |
| --- | --- | --- | --- |
| private | | | |
| repo | | | |
| team | | | |
| public | | | |

## Scope Ladder

Declared once, in order: `private -> repo -> team -> public`.
Single source of truth: <file/module path role and consent logic derive the ordering from>
`scopeLadderOrdered`: <true/false — must be true before ship>
```

## Checklist before marking ready

- [ ] Every `requiresIdentity: true` feature also has `hasLocalOnlyPath: true`, or has been explicitly cut from the identity-gated surface.
- [ ] Every feature with `scopeTier` other than `private` has a real, user-visible consent screen before its first tier crossing.
- [ ] No feature is marked `scopeTier: private` while also claiming a tier-crossing consent screen (fix the contradiction, don't silence the finding).
- [ ] `localOnlyMode.uploadsNothingTestable` is `true`, backed by an actual runtime check, not a doc comment.
- [ ] `exportDelete.perTierSupported` is `true`, verified for every tier in play — not just the ones that shipped first.
- [ ] `scopeLadderOrdered` is `true`: the private/repo/team/public order lives in one declared place.
- [ ] `node scripts/tenancy_boundary_audit.mjs --input <spec>.json` returns `pass: true`.
