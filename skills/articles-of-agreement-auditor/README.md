# Articles of Agreement Auditor

Audit an Articles of Agreement contract — the daemon-witnessed agreement every official Port Daddy agent signs — against the enforcement-beats-hope bar: every clause resolves to a concrete, daemon-observable mechanism, gates define a real denial shape, and the signing identity is daemon-issued and signed, never self-asserted.

Use this skill when drafting a new agent's Articles, reviewing a compliance-level claim, deciding whether a clause is genuinely enforced or merely documented, or auditing whether a claimed identity can be trusted.

## Quick Start

1. Read `SKILL.md` for the identity-then-clause decision model and the three anti-patterns.
2. Skim `references/enforcement-mechanism-taxonomy.md` to pick a real mechanism (and, for gates, a denial shape) per clause.
3. Skim `references/compliance-levels-and-identity.md` for how the C0–C6 compliance ladder and daemon-issued identity fit together.
4. Fill in `templates/output-template.md` to draft the Articles contract in plain language.
5. Build an Articles spec JSON matching `schemas/articles.schema.json` and audit it:

```bash
node scripts/articles_audit.mjs --input <your-articles-spec>.json
```

6. Compare against `examples/expected-output.md` to see a hopeful/self-attested contract audited, then the same contract fixed and passing.
