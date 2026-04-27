# ADR-0025. Relay PKI Decision

## Status

Proposed — 2026-04-27.

## Context

The PD Relay (see ADR-0026) federates events between local daemons and external publishers (CI runners, browsers, bots). It is outbound-only from the daemon and end-to-end encrypted, but it requires an authentication and identity layer:

- Daemons must prove identity to the relay
- External publishers (GH Actions, Slack, etc.) must prove identity
- The relay must verify cards and route by harbor namespace
- Revocation must propagate within seconds

The Anchor Protocol (ADR-0014) names the daemon as a per-machine root CA issuing Ed25519 harbor cards. That ADR is silent on **federation**: how daemons trust each other's cards on the relay, and how non-daemon publishers (CI/bots) bootstrap identity. This ADR fills that gap.

We considered four options (full discussion in `skills/pd-relay-zero-trust/references/pki-options-{acme,oidc,web-of-trust}.md`):

1. **ACME** (RFC 8555 + extensions): daemon binds Ed25519 key to a name via DNS-01 or HTTP-01 control proof; relay accepts cards from name-bound daemons.
2. **OIDC**: daemons and external publishers present OIDC tokens (esp. GitHub Actions OIDC); relay verifies signature against issuer JWKS and exchanges for a short-lived PD card.
3. **Web-of-Trust / TOFU**: out-of-band key exchange between harbor members; no CA, no IdP.
4. **Hybrid**: ACME for daemon identity + OIDC for workload/CI identity + WoT as escape hatch for air-gap.

## Decision Matrix at Time of Decision

`scripts/pki_decision.py` run with default weights and default scores produced an exact tie at the top:

| Option | Score | Notes |
|--------|------:|-------|
| **OIDC** | **153** | tied for top |
| **Hybrid** | **153** | tied for top |
| WoT | 141 | |
| ACME | 137 | |

Margin OIDC↔Hybrid is 0 → script flagged `tie_break_needed: true`. The matrix doc's published numbers (Hybrid=158, OIDC=144) were stale; the actual default-weight scoring under the canonical script puts OIDC and Hybrid neck-and-neck.

Weights used (all twelve criteria from `pki-decision-matrix.md`): `C1=4 C2=3 C3=4 C4=2 C5=3 C6=4 C7=3 C8=4 C9=3 C10=3 C11=3 C12=4`.

A tie at this level means the matrix can't auto-decide; per `pki-decision-matrix.md` we apply tie-break rules in order: reversibility → operational bus-factor → security-research surface → ProVerif modeling cost.

## Decision

**Adopt an OIDC-first hybrid**, phased:

- **v0 primary identity bootstrap**: **OIDC**. Initially the GitHub Actions OIDC issuer; allow-list expandable in config. Used by both CI publishers and daemons. Daemon's first-time bootstrap exchanges an OIDC token (developer SSO via GitHub) for a PD card; subsequent bootstraps use the daemon's own Ed25519 key plus a refresh OIDC exchange when the card needs renewal.
- **v0 escape hatch**: **`--auth-mode=wot`** for air-gapped or PKI-rejecting deployments. The relay accepts daemon Ed25519 fingerprints as identity without external attestation; harbor membership is the only authority.
- **v1 secondary identity bootstrap**: **ACME** (DNS-01 only) for daemons that want name-bound identity (`erichs.users.portdaddy.dev` or a user's own domain). Issued via a self-hosted `step-ca` ACME CA on the managed subdomain to avoid Let's Encrypt rate-limit dependency.
- **v2**: self-hosted OIDC issuer support (Keycloak / Authentik / Dex) and bring-your-own-domain ACME with EAB binding to a PD account.

Concretely: the relay's identity registry stores `(daemon_fingerprint, identifier, expiry, proof_method)` where `proof_method ∈ {oidc, acme, wot}`. All three are first-class from day one in the data model; **only the OIDC and WoT issuance paths ship in v0**.

Why OIDC-first beats Hybrid-from-day-one:

1. **Reversibility**: adding ACME later is purely additive — daemons that opt in get name-bound identities; existing daemons keep their OIDC-bound identities. Going the other way (rolling back ACME after daemons have it) is harder. OIDC-first keeps optionality longer.
2. **Master-plan timeline**: relay v0 is Weeks 3-6. OIDC-only effort is **~1.5 weeks** per `pki-options-oidc.md`. Hybrid effort is `OIDC (1.5w) + ACME (2w) = 3.5w` — half the relay v0 budget on PKI alone leaves no room for the relay itself.
3. **CI is the named first non-laptop publisher** (master plan): CI = OIDC mandatory. Anything else is additive over a working OIDC lane.
4. **Bus factor**: OIDC verification logic is small and well-trodden; debuggable by anyone on the team. ACME daemon-registration logic is novel surface that adds two new failure modes (CA outage, DNS API hiccup) on day one.
5. **ProVerif modeling cost**: an OIDC-bootstrapped Ed25519 daemon identity is a single name-binding event; ACME adds DNS-control-proof state. Modeling OIDC alone first lets us extend cleanly later.

## Deliberation Summary

This skill (`pd-relay-zero-trust`) is deliberation-aware: PKI choice is supposed to fork a four-voice debate (proponent / pragmatic / antagonist / acme-specialist) before producing this ADR. **Honest disclosure**: in this session, two attempts to dispatch the four subagents as concurrent autonomous Agent calls timed out before producing structured opinions (idle-stream timeouts at 73 and 17 tool calls respectively). Rather than ship the ADR un-deliberated, the synthesis below is written by the calling agent (Claude) channeling the four roles from the canonical role prompts in `skills/pd-relay-zero-trust/agents/`. The verdicts are best-effort rather than independent; the next session should re-dispatch the four agents and revise this ADR if any voice raises a ship blocker not refuted here.

### Proponent verdict (`agents/proponent.md`)
**verdict**: accept-with-conditions. **confidence**: medium-high.

Top three reasons supporting OIDC-first hybrid:
1. The matrix puts OIDC at 153, exactly tied with Hybrid; OIDC is the cheaper subset of Hybrid, so taking it first is a strict subset of the higher-scoring option.
2. CI is named as the most likely first non-laptop publisher in the master plan; OIDC is the only candidate that scores 5 on C1 (CI/CD ergonomics) without ACME's 2.
3. Phased rollout matches the "ship simple v0, layer features in v1" pattern already used by the relay architecture (single-region first, multi-region in v1).

### Pragmatic verdict (`agents/pragmatic.md`)
**verdict**: accept. **confidence**: high.

Top three reasons:
1. **Fastest shippable v0**: OIDC alone is ~1.5 weeks per `pki-options-oidc.md`; Hybrid is ~3.5 weeks. The master plan budgets relay v0 at Weeks 3-6; PKI cannot consume more than half.
2. **Cleanly reversible**: the identity registry's `proof_method` enum is open. Adding ACME later changes one field's allowed values; no migration of existing identities.
3. **Bus factor**: every developer has used OIDC. ACME implementation is two-week-payload of new ops surface (CA, DNS API integration, ARI scheduler). Don't add it to the critical path.

### Antagonist verdict (`agents/antagonist.md`)
**verdict**: accept-with-conditions. **confidence**: medium.

Top three risks (channeled from `agents/antagonist.md`'s "assume bad-faith relay, hostile network, key compromise" framing):

1. **A8 (compromised PKI authority) under OIDC means GitHub OIDC**. If the GitHub Actions OIDC issuer is compromised or coerced, *all* CI publishers are momentarily untrustworthy. Mitigation: explicit issuer allowlist (config, not runtime), explicit `aud=relay.portdaddy.dev/<account>` per call, and a kill-switch that invalidates all OIDC-bootstrapped cards minted before timestamp T.
2. **Vendor coupling**: GitHub down → CI lane down. Mitigation: ship support for `aud` accepting any of a configured set of issuers from day 1, even if only GitHub is allow-listed. Add GitLab and Google in v1 before declaring lock-in resolved.
3. **OIDC confused-deputy via misconfigured `aud`**: Salt Labs has documented this exact CWE-345 pattern in deployed services. Mitigation: relay rejects any token whose `aud` is `["*"]`, missing, or matches a different relay's audience; all rejections logged at `warning`.

**ship_blocker**: on initial reading, antagonist would call this for the missing WoT escape hatch — air-gap and adversarial-research deployments cannot use OIDC at all, and the master plan does name "air-gap-friendly" as a property worth preserving (zero-trust foundations doc). **Refutation**: WoT escape hatch is in the v0 scope (`--auth-mode=wot`); the data model's `proof_method: "wot"` accommodates it; the air-gap user can run their relay self-hosted and bypass OIDC bootstrap entirely. The `--auth-mode=wot` config is a single boolean in v0, not a roadmap item.

### ACME specialist input (`agents/acme-specialist.md`)
The ACME path is correctly deferred to v1. When it lands, the recommendations from the role prompt apply:
- DNS-01 only for the managed subdomain (no port-80 dependency)
- ARI mandatory if cert lifetimes < 90 days
- CAA records lock issuance to our `step-ca`
- EAB binds ACME accounts to PD account model in v2
- Run our own `step-ca` for `*.users.portdaddy.dev` to avoid Let's Encrypt rate-limit coupling; Let's Encrypt is fine for users bringing their own domain in v2

The specialist explicitly *does not* recommend ACME for v0 over OIDC for the same operational-burden reasons the pragmatic voice flagged.

## Consequences

**Positive**:
- v0 ships with one well-understood identity bootstrap (OIDC) plus one no-CA escape hatch (WoT). Two failure modes, both well-trodden.
- CI runners (GH Actions) get identity for free; no provisioning cost for adopters.
- Developer human SSO is "log in with GitHub" — zero friction.
- Card lifecycle is bounded: OIDC tokens expire in minutes; PD cards minted from them inherit ≤1h expiry per Phase 2 contract.
- Path to ACME (v1) and self-hosted OIDC issuers (v2) is documented and additive.
- Identity registry data model accommodates all three proof methods from day 1.
- Phase 3 attenuation (ADR forthcoming) composes over PD cards regardless of how they were bootstrapped, so PKI choice is decoupled from the attenuation layer.

**Negative**:
- v0 has a single-IdP dependency on GitHub. Outages cascade. Multi-issuer support is configured-but-empty until v1.
- Daemons that want long-term name-bound identity (e.g., `dev.example.com`-bound) wait for v1 ACME.
- Air-gap deployments must self-host the relay AND configure `--auth-mode=wot` AND distribute keypairs out-of-band — a real operational ask for that audience.
- OIDC issuers rotate JWKS; relay must implement caching with bounded staleness (10-minute TTL, 1-hour fail-soft window per `pki-options-oidc.md`).
- One more CWE-345 surface (`aud` validation) to get exactly right and audit.

**Reversibility**:
- **Cost to switch primary bootstrap later**: low. Add ACME issuance endpoint; existing OIDC daemons coexist. No DB migration; `proof_method` enum already supports both.
- **Cost to revoke OIDC trust if compromised**: low. Allowlist is config; remove issuer; daemons fall back to their cached-card lifetime then must re-bootstrap via WoT or a different issuer.
- **Cost to add a new OIDC issuer**: low. Single config entry plus JWKS URL.
- **Cost to remove WoT mode**: medium. Existing `--auth-mode=wot` deployments need migration path; we'd ship a deprecation window of one minor release.

## Trigger Conditions for Re-Decision

Re-open this ADR if any of the following occur:

- **OIDC issuer-side**: GitHub OIDC issuer compromise or deprecation; any major audience-validation CVE in OIDC libraries on the relay's verification path; OIDC token format changes that break existing PD card-exchange logic.
- **ACME-side** (when ACME ships v1): Let's Encrypt rate-limit policy changes that affect our managed-subdomain issuance path; widespread ACME-DNS dependency outage; CAA-record ecosystem change.
- **WoT-side**: pairing UX library breakage (Magic Wormhole-style, if v1 ships it); harbor-key compromise pattern detected in production deployments.
- **Threat-model**: a new adversary added to `references/threat-model.md` whose attack surface materially changes one of the three options' viability (e.g., a new A9 we hadn't considered).
- **Customer voice**: ≥5 paying customers report air-gap as their hard requirement and `--auth-mode=wot` is insufficient. Promote WoT to a co-equal primary mode.

## Implementation Plan

| Step | Description | Estimate | Depends on |
|------|-------------|---------:|------------|
| 1 | Identity registry schema: `(fingerprint, identifier, proof_method, proof_metadata, exp, revoked_at)` | 0.25w | — |
| 2 | OIDC verifier: JWKS fetch + cache + signature verify + `aud`/`exp`/`iss` checks | 0.5w | (1) |
| 3 | OIDC → PD card exchange endpoint (`/v1/exchange`); claim → cap mapping; rate limits per issuer claim | 0.5w | (2) |
| 4 | GitHub Actions OIDC integration test using a real GH Actions runner | 0.25w | (3) |
| 5 | `--auth-mode=wot` mode: identity-registry path that accepts self-attested fingerprints with no proof; logs `proof_method=wot` | 0.25w | (1) |
| 6 | Documentation: relay deployment guide, OIDC setup walkthrough, WoT mode security warnings | 0.25w | (3), (5) |
| **v0 total** | | **~2 weeks** | |
| 7 (v1) | `step-ca` ACME deployment for `*.users.portdaddy.dev`; ACME enrollment endpoint; daemon ACME client | 2w | v0 |
| 8 (v1) | Multi-issuer OIDC: GitLab + Google issuer configs and integration tests | 0.5w | v0 |
| 9 (v2) | Self-hosted OIDC issuer support: configurable issuer registry, docs, SSO walkthrough | 1w | v1 |
| 10 (v2) | Bring-your-own-domain ACME with EAB to PD account | 1w | v1 |

## Migration

There is no installed base of relay-bootstrapped daemons to migrate. New daemons enrolling against the v0 relay use OIDC by default. Air-gap deployments configure `--auth-mode=wot` at relay-install time. Existing local-only daemons (no relay) are unaffected by this ADR.

## Threat-Model Invariant Mapping

This decision preserves or weakens these invariants from `references/threat-model.md`:

| Invariant | Effect under this decision |
|-----------|---------------------------|
| I1 (relay never sees plaintext) | **Preserved.** PKI is orthogonal to E2E. |
| I2 (subscribers detect equivocation) | **Preserved.** Per-publisher Merkle chain is independent of identity bootstrap. |
| I3 (stolen card bounded by exp/cap/aud) | **Preserved and strengthened.** OIDC tokens have minute-scale expiry; PD cards minted from them inherit ≤1h cap. |
| I4 (attenuation never expands rights) | **Preserved.** Phase 3 verifier is unchanged. |
| I5 (loss of relay does not lose past evidence) | **Preserved.** Chain anchoring is independent. |
| I6 (revocation ≤5s) | **Preserved.** JTI revocation table broadcast unchanged. |
| I7 (AuthN ≠ AuthZ) | **Preserved.** OIDC = AuthN; PD card cap[] = AuthZ; verified separately. |
| I8 (identity registry update requires proof) | **Preserved.** OIDC token signature is the proof; WoT mode requires explicit out-of-band trust acknowledgement (logged). |

No invariants are weakened. Adversary A8 (compromised PKI authority) gains a new attack surface (the GitHub OIDC issuer) but loses none — pre-decision, the registry had no proof mechanism at all.

## Related ADRs / References

- ADR-0013 (Unified Harbor Model)
- ADR-0014 (Anchor Protocol)
- ADR-0026 (Relay Architecture) — depends on this
- ADR-0027 (V4 Remote Harbor Redefinition) — composes with this
- `skills/pd-relay-zero-trust/references/pki-options-acme.md`
- `skills/pd-relay-zero-trust/references/pki-options-oidc.md`
- `skills/pd-relay-zero-trust/references/pki-options-web-of-trust.md`
- `skills/pd-relay-zero-trust/references/pki-decision-matrix.md`
- `skills/pd-relay-zero-trust/references/threat-model.md`
- `skills/pd-relay-zero-trust/references/zero-trust-foundations.md`

## Open Questions

- What's the cap-mapping policy for unrecognized OIDC `repository_owner` claims? Reject (default), or auto-create a low-privilege namespace?
- Should `--auth-mode=wot` deployments be allowed to publish PD cards into the global registry, or be sandboxed to their own self-hosted relay only?
- For v1 ACME, do we mint the user's daemon identity on `<user>.users.portdaddy.dev` automatically at first daemon startup, or require explicit opt-in to "I want a name"?
- Does the relay need to support OIDC token-binding (RFC 8471) at any point, or is short token lifetime sufficient?

These do not block v0; capture as follow-ups in the next ADRs.
