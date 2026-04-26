# ADR-0021. Relay PKI Decision

## Status

Proposed

## Context

The PD Relay (see ADR-0022) federates events between local daemons and external publishers (CI runners, browsers, bots). It is outbound-only from daemons and end-to-end encrypted, but it requires an authentication and identity layer:

- Daemons must prove identity to the relay
- External publishers (GH Actions, Slack, etc.) must prove identity
- Relay must verify cards and route by harbor namespace
- Revocation must propagate within seconds

The Anchor Protocol (ADR-0014) names the daemon as a per-machine root CA issuing Ed25519 harbor cards. The protocol is silent on **federation**: how daemons trust each other's cards on the relay, and how non-daemon publishers (CI/bots) bootstrap identity.

We considered three options (full discussion in `references/pki-options-acme.md`, `pki-options-oidc.md`, `pki-options-web-of-trust.md`):

1. **ACME** (RFC 8555 + extensions): daemon binds Ed25519 key to a name via DNS or HTTP control proof; relay accepts cards from name-bound daemons.
2. **OIDC**: daemons and external publishers present OIDC tokens (esp. GitHub Actions OIDC); relay verifies signature against issuer JWKS and exchanges for a PD card.
3. **Web-of-Trust**: out-of-band key exchange between harbor members; no CA, no IdP.
4. **Hybrid**: ACME for daemon identity, OIDC for workload/CI identity, WoT as escape hatch for air-gap.

The decision matrix (`references/pki-decision-matrix.md`) under default weights ranks **Hybrid > OIDC > ACME > WoT**, with Hybrid–OIDC margin small enough to be deliberation-sensitive.

## Decision

[CHOSEN OPTION: ___________ — fill in after deliberation]

Defaults shipped:
- Primary identity bootstrap: [____]
- Secondary / escape-hatch: [____]
- Air-gap mode supported: [yes/no/with-config]

## Deliberation Summary

**Proponent verdict** (`agents/proponent.md`): [verdict] / [confidence]
- Top reasons: [...]

**Pragmatic verdict** (`agents/pragmatic.md`): [verdict] / [confidence]
- Top reasons: [...]

**Antagonist verdict** (`agents/antagonist.md`): [verdict] / [confidence]
- Top risks: [...]
- Ship blocker: [yes/no]
- If yes: refutation [...]

**ACME specialist input** (`agents/acme-specialist.md`): [...]

## Decision Matrix at Time of Decision

(Insert weights actually used + score table from `scripts/pki_decision.py`.)

## Consequences

**Positive**:
- [...]

**Negative**:
- [...]

**Reversibility**:
- Cost to switch primary identity bootstrap later: [estimate]
- Cost to add another option later: [estimate]

## Trigger Conditions for Re-Decision

- ACME: Let's Encrypt rate-limit policy changes; CA compromise; ACME-DNS dependency outage
- OIDC: GitHub OIDC issuer compromise; deprecation; major audience-validation CVE
- WoT: pairing UX library breakage; harbor-key compromise pattern detected

## Implementation Plan

1. [Pre-work — schema changes, identity registry tables]
2. [Bootstrap path — first PKI mechanism wired]
3. [Test vectors and golden cards]
4. [Documentation]
5. [Migration guide for existing daemons]

## Related ADRs / References

- ADR-0014 (Anchor Protocol)
- ADR-0013 (Unified Harbor Model)
- ADR-0022 (Relay Architecture) — depends on this
- ADR-0023 (V4 Remote Harbor Redefinition) — composes with this
- references/zero-trust-foundations.md
- references/pki-decision-matrix.md
- references/threat-model.md

## Open Questions

- [...questions left for follow-up ADRs...]
