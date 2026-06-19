# PKI Decision Matrix

> **Status (2026-04-27)**: This matrix was the deliberation input for **[ADR-0025 (Relay PKI Decision)](../../../docs/adr/0025-pki-decision.md)**. Default-weight scoring produced an exact tie (OIDC=153, Hybrid=153, WoT=141, ACME=137); the tie was broken by reversibility and master-plan timeline considerations in favor of an OIDC-first hybrid. The matrix is preserved here for re-scoring under future weight changes (see ADR-0025 §Trigger Conditions for Re-Decision).

**Load when**: scoring PKI options against criteria; running `scripts/pki_decision.py`.

## Criteria and weights

These weights are *defaults*; override per project context. Scores are 1 (worst) – 5 (best).

| # | Criterion | Weight | Why it matters |
|---|-----------|--------|----------------|
| C1 | CI/CD ergonomics | 4 | We've named GH Actions as the most likely first non-laptop publisher. |
| C2 | Solo-dev local-only UX | 3 | Don't break the "install and go" experience. |
| C3 | Team onboarding friction | 4 | Adoption depends on this. |
| C4 | Air-gap / self-host fit | 2 | Real for some users; not majority case. |
| C5 | Cryptographic key-binding clarity | 3 | Affects formal verification and audit. |
| C6 | Revocation propagation latency | 4 | Compromised credentials must die fast. |
| C7 | Vendor independence | 3 | "GitHub down = PD down" is a hard bug. |
| C8 | Implementation effort to v0 | 4 | We need to ship. |
| C9 | Operational complexity in production | 3 | Future ops cost. |
| C10 | Auditability / forensic trace | 3 | Required for incident response. |
| C11 | Standards maturity / library availability | 3 | Reduce custom-crypto risk. |
| C12 | Composes with Phase 3 attenuation | 4 | Attenuation must work over chosen identity. |

## Default scores

These are starting estimates. Re-score per real-world conditions.

| Criterion | ACME | OIDC | WoT | Hybrid (ACME daemon + OIDC workloads) |
|-----------|------|------|-----|----------------------------------------|
| C1 CI/CD ergonomics | 2 | 5 | 1 | 5 |
| C2 Solo-dev local UX | 3 | 4 | 5 | 4 |
| C3 Team onboarding | 4 | 5 | 1 | 5 |
| C4 Air-gap | 2 | 1 | 5 | 2 (with WoT escape hatch) |
| C5 Key-binding clarity | 4 | 3 | 5 | 4 |
| C6 Revocation | 3 | 4 | 2 | 4 |
| C7 Vendor independence | 3 | 2 | 5 | 3 |
| C8 v0 effort | 3 | 4 | 5 | 2 |
| C9 Ops complexity | 3 | 3 | 4 | 2 |
| C10 Auditability | 5 | 4 | 3 | 5 |
| C11 Standards maturity | 5 | 5 | 3 | 5 |
| C12 Phase 3 composition | 4 | 4 | 5 | 4 |

## Computing the weighted score

Run:

```
python scripts/pki_decision.py <<'JSON'
{"kind":"request","version":"1","command":"pki.score","payload":{"options":["ACME","OIDC","WoT","Hybrid"]}}
JSON
```

The script:
1. Reads the score table (above, parsed from this file or passed in payload)
2. Multiplies each score by criterion weight
3. Sums per-option
4. Returns ranked options + per-criterion narrative
5. Flags ties and asks the deliberation set to break them

Canonical default-weight ranking from `scripts/pki_decision.py`:
- **OIDC: 153**
- **Hybrid: 153**
- **WoT: 141**
- **ACME: 137**

OIDC and Hybrid tie under default weights, so the matrix does not auto-decide. Apply the tie-breakers below and run the deliberation set. In the PR #5 deliberation, the tie-break favored OIDC-first because it is the reversible subset of Hybrid and keeps ACME additive.

## How to use the matrix in deliberation

1. Compute scores with default weights → get a baseline.
2. Re-weight per stakeholder argument (e.g., antagonist may argue C7 should be weight 5; pragmatic may argue C8 should be weight 5).
3. Re-rank.
4. If ranking is stable across re-weightings: high confidence.
5. If ranking flips on small weight changes: low confidence. Defer or split decision.

## Tie-breakers

When two options are within 5 points:

1. Reversibility: prefer the option easier to migrate away from. (Phase 3 attenuation makes most options reversible.)
2. Operational bus-factor: prefer the option where more team members can debug.
3. Latest 12-month security-research surface: prefer options without recent critical CVEs.
4. ProVerif modeling cost: prefer the option with simpler symbolic model.

## What the matrix does NOT capture

- **Brand and positioning.** "We use ACME like the grown-ups" vs "We accept GitHub identity" are marketing decisions.
- **Customer voice.** If five paying customers say "we need air-gap," WoT moves up regardless of score.
- **Founder taste.** Erich's call. The matrix is *input* to the decision, not the decision.

## Output of decision

Whatever you choose, fill in `templates/ADR-PKI-Decision.md` with:
- The chosen option(s)
- The matrix at decision time (with weights actually used)
- The deliberation summary (proponent / pragmatic / antagonist verdicts)
- Reversal cost estimate if the choice turns out wrong
- Trigger conditions that would force a re-decision (e.g., "Let's Encrypt rate limit changes," "GitHub OIDC issuer compromised")

## Related references

- `pki-options-acme.md`
- `pki-options-oidc.md`
- `pki-options-web-of-trust.md`
- `relay-architecture.md` (downstream of PKI choice)
