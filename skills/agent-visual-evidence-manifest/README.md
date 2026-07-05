# Agent Visual Evidence Manifest

Verify that every visual-evidence artifact (screenshot/GIF/recording) attached to a PR carries a provenance manifest binding it to real daemon-backed truth, and that control-panel PRs cover the required set of states.

Use this skill when gating a PR's proof artifacts before merge, auditing whether a "LIVE" or "it works" visual claim is backed by a real daemon run, or defining the required state-coverage set for an operator-control-panel change.

## Quick Start

1. Read `SKILL.md` for the manifest-completeness-and-coverage process and the three anti-patterns.
2. Skim `references/manifest-field-semantics.md` before deciding whether a manifest field is genuinely missing versus just differently named.
3. Skim `references/control-panel-state-coverage.md` before deciding whether a PR is "control-panel" and, if so, which states it still needs.
4. Fill in `templates/output-template.md` per artifact while assembling the PR body.
5. Build a proof-manifest-spec JSON matching `schemas/proof-manifest-spec.schema.json` and audit it:

```bash
node scripts/proof_manifest_audit.mjs --input <your-proof-manifest-spec>.json
```

6. Compare against `examples/expected-output.md` to see a bad manifest set audited, then the same set fixed and passing.
