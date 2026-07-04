# Agent Compliance Conformance

Audit a compliance-ladder design (C0-C6) and transcript-fidelity ladder (T0-T5), plus their adapter conformance fixtures, for cross-surface drift and self-attestation bypass before any C-badge or T-fidelity label ships.

Use this skill when freezing a compliance ladder, wiring an adapter conformance probe suite across Codex, Claude Code, Cloudflare, Ollama/LM Studio, or a custom agent, or deciding whether a numeric compliance label is safe to render.

## Quick Start

1. Read `SKILL.md` for the freeze-diff-probe-witness process and the three anti-patterns.
2. Skim `references/compliance-and-fidelity-ladders.md` for the canonical C0-C6 / T0-T5 level definitions and the real C3-naming contradiction they must not repeat.
3. Skim `references/negative-probe-catalog.md` before wiring or auditing any adapter fixture — it defines the five required probe kinds and the `present` vs `downgraded` distinction.
4. Fill in `templates/output-template.md` for the actual ladder-freeze decision.
5. Build a conformance-spec JSON matching `schemas/conformance-spec.schema.json` and audit it:

```bash
node scripts/conformance_audit.mjs --input <your-conformance-spec>.json
```

6. Compare against `examples/expected-output.md` to see a drifted, self-attesting ladder audited, then the same design frozen and passing.
