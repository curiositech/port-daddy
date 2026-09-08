# ADR-0025. Relay PKI Decision

## Status

Accepted — 2026-06-10. Four-voice deliberation (proponent / pragmatic / antagonist / acme-specialist) completed; all three deliberators returned `accept` or `accept-with-conditions`; no ship blockers. ADR-0049 depends on this.

Amended — 2026-08-21. Relay-managed service actors may use the narrowly scoped
`operator-provisioned` proof method described below; this does not change the
OIDC-first bootstrap decision for arbitrary external publishers or daemons.

## Context

The PD Relay (see ADR-0026) federates events between local daemons and external publishers (CI runners, browsers, bots). It is outbound-only from the daemon and end-to-end encrypted, but it requires an authentication and identity layer:

- Daemons must prove identity to the relay
- External publishers (GH Actions, Slack, etc.) must prove identity
- The relay must verify cards and route by harbor namespace
- Revocation must propagate within seconds

The Anchor Protocol (ADR-0014) names the daemon as a per-machine root CA issuing Ed25519 harbor cards. That ADR is silent on **federation**: how daemons trust each other's cards on the relay, and how non-daemon publishers (CI/bots) bootstrap identity. This ADR fills that gap.

We considered four options (full discussion in
`skills/pd-relay-zero-trust/references/pki-options-acme.md`,
`skills/pd-relay-zero-trust/references/pki-options-oidc.md`, and
`skills/pd-relay-zero-trust/references/pki-options-web-of-trust.md`):

1. **ACME** (RFC 8555 + extensions): daemon binds Ed25519 key to a name via DNS-01 or HTTP-01 control proof; relay accepts cards from name-bound daemons.
2. **OIDC**: daemons and external publishers present OIDC tokens (esp. GitHub Actions OIDC); relay verifies signature against issuer JWKS and exchanges for a short-lived PD card.
3. **Web-of-Trust / TOFU**: out-of-band key exchange between harbor members; no CA, no IdP.
4. **Hybrid**: ACME for daemon identity + OIDC for workload/CI identity + WoT as escape hatch for air-gap.

## Decision Matrix at Time of Decision

`skills/pd-relay-zero-trust/scripts/pki_decision.py` run with default weights and
default scores produced an exact tie at the top:

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

- **v0 primary identity bootstrap**: **OIDC**. Initially the GitHub Actions OIDC issuer for workload publishers; allow-list expandable in config. Daemon human bootstrap must use an explicit developer OIDC/device-login exchange before it becomes default-on. If that flow is not ready, daemon enrollment uses the admin-approved WoT path below while workload publishing still uses OIDC.
- **v0 escape hatch**: **`--auth-mode=wot`** for self-hosted, harbor-local, air-gapped, or PKI-rejecting deployments. WoT is not accepted into the managed/global identity registry in v0. A relay only accepts an Ed25519 fingerprint after explicit admin approval through a configured allowlist or signed pairing receipt; a self-attested fingerprint plus a log line is not proof.
- **v1 secondary identity bootstrap**: **ACME** (DNS-01 only) for daemons that want name-bound identity (`erichs.users.portdaddy.dev` or a user's own domain). Issued via a self-hosted `step-ca` ACME CA on the managed subdomain to avoid Let's Encrypt rate-limit dependency.
- **v2**: self-hosted OIDC issuer support (Keycloak / Authentik / Dex) and bring-your-own-domain ACME with EAB binding to a PD account.

Concretely: the relay's identity registry stores `(daemon_fingerprint, identifier, proof_method, proof_metadata, exp, revoked_at)` where `proof_method ∈ {oidc, acme, wot, operator-provisioned}`. `proof_metadata` is proof-method-specific and must be able to store OIDC issuer/JTI/iat/audience data, ACME DNS identifier/issuer/account/renewal metadata, WoT pairing or allowlist receipt data, and an operator-provisioned service actor's issuer/JTI/iat/deployment tuple. OIDC, ACME, and WoT are the general bootstrap methods; **only OIDC exchange and self-hosted/harbor-local admin-approved WoT issuance ship in v0**. `operator-provisioned` is not a general fourth bootstrap lane: it is reserved for Relay-managed service actors, requires the Relay operator credential, registers only a public key, and mints a narrowly capability-scoped Relay-issued card.

v0 acceptance requirements:

- OIDC exchange is fail-closed: missing `aud`, wildcard `aud`, wrong `aud`, wrong `iss`, expired `exp`, invalid `nbf`, unknown issuer, unknown `repository_owner`, or ambiguous cap mapping rejects. v0 does not auto-create namespaces from unrecognized OIDC claims.
- OIDC issuer recovery is normative, not optional: store `proof_issuer`, `proof_jti`, `proof_iat` or `minted_at`, and support revoke-all-by-issuer-and-time with the same ≤5s revocation broadcast target as card revocation.
- JWKS fail-soft is availability-only. Disabled issuers or suspected key compromise bypass cached JWKS immediately.
- WoT v0 is self-hosted/harbor-local only. Managed/global registry publication requires OIDC in v0, ACME in v1, or a later ADR that gives WoT a stronger proof and key-transparency story.
- ACME remains a proof method bound to the daemon Ed25519 fingerprint. The X.509 certificate is proof metadata for name control; it is not the daemon-to-relay transport credential.

Why OIDC-first beats Hybrid-from-day-one:

1. **Reversibility**: adding ACME later is purely additive — daemons that opt in get name-bound identities; existing daemons keep their OIDC-bound identities. Going the other way (rolling back ACME after daemons have it) is harder. OIDC-first keeps optionality longer.
2. **Master-plan timeline**: relay v0 is Weeks 3-6. OIDC-only effort is **~1.5 weeks** per `pki-options-oidc.md`. Hybrid effort is `OIDC (1.5w) + ACME (2w) = 3.5w` — half the relay v0 budget on PKI alone leaves no room for the relay itself.
3. **CI is the named first non-laptop publisher** (master plan): CI = OIDC mandatory. Anything else is additive over a working OIDC lane.
4. **Bus factor**: OIDC verification logic is small and well-trodden; debuggable by anyone on the team. ACME daemon-registration logic is novel surface that adds two new failure modes (CA outage, DNS API hiccup) on day one.
5. **ProVerif modeling cost**: an OIDC-bootstrapped Ed25519 daemon identity is a single name-binding event; ACME adds DNS-control-proof state. Modeling OIDC alone first lets us extend cleanly later.

## Deliberation Summary

This skill (`pd-relay-zero-trust`) is deliberation-aware: PKI choice forks a four-voice debate (proponent / pragmatic / antagonist / acme-specialist) before producing this ADR. The four roles were re-dispatched against this PR branch and each confirmed `pd-relay-zero-trust` as the governing skill. The synthesis below reflects those independent outputs rather than the earlier channeled draft.

### Proponent verdict (`agents/proponent.md`)
**verdict**: accept-with-conditions. **confidence**: high.

Top three reasons supporting OIDC-first hybrid:
1. The matrix puts OIDC at 153, exactly tied with Hybrid; OIDC is the cheaper subset of Hybrid, so taking it first is a strict subset of the higher-scoring option.
2. The OIDC-to-PD-card exchange is the key architecture: OIDC is bootstrap only, then PD cards carry short-lived capabilities, audience checks, and revocation.
3. Deferring ACME is technically sound because ACME contributes name binding but also brings DNS API, CA, renewal, ARI, CAA, and EAB operations that are not needed for the first CI lane.

Proponent conditions: update the stale matrix reference, make v0 OIDC acceptance conditions explicit, and clarify the WoT boundary so it is not over-sold.

### Pragmatic verdict (`agents/pragmatic.md`)
**verdict**: accept-with-conditions. **confidence**: high.

Delivery cut:
1. v0 includes GitHub Actions OIDC, method-tagged identity proofs, fail-closed OIDC verification, short-lived PD card issuance, a narrow self-hosted/harbor-local WoT escape hatch, and a real GitHub Actions integration test.
2. v0 explicitly excludes ACME enrollment, BYO domains, self-hosted OIDC issuers, Google/GitLab OIDC beyond preserving config shape, and full WoT pairing UX.
3. Estimated v0 remains roughly two weeks if WoT is kept to an admin-approved allowlist/pairing receipt. Full import/export, fingerprint display, and pairing UX is closer to the reference's one-week WoT estimate and should not be smuggled into a 0.25w line item.

Pragmatic conditions: name the daemon bootstrap flow before implementation, reject unknown cap mappings by default, and reconcile the matrix-score drift.

### Antagonist verdict (`agents/antagonist.md`)
**initial verdict**: reject. **confidence**: high. **blocker accepted and fixed in this revision**.

Top risks:

1. **I8 blocker in the earlier draft**: the ADR said WoT required explicit out-of-band trust, but the implementation plan accepted self-attested fingerprints with no proof. This revision changes v0 WoT to admin-approved fingerprint allowlists or signed pairing receipts, scoped to self-hosted/harbor-local relays only.
2. **A8 GitHub OIDC compromise or outage**: recovery needs issuer disablement, JWKS fail-soft bypass, bulk issuer/time-window revocation, affected-namespace notification, and JTI auditability.
3. **I7 cap-mapping ambiguity**: unrecognized `repository_owner` or ambiguous issuer claims must reject by default; auto-creating namespaces would make the bootstrap allow-by-default.

The antagonist also required that this ADR not advance from Proposed to Accepted until real cited deliberation outputs exist. That quality gate is now satisfied for the PR revision; the ADR status remains Proposed until normal project approval.

### ACME specialist input (`agents/acme-specialist.md`)
The ACME path is correctly deferred to v1. When it lands, the recommendations from the role prompt apply:
- DNS-01 only for the managed subdomain (no port-80 dependency)
- ARI mandatory if cert lifetimes < 90 days
- CAA records lock issuance to our `step-ca`
- EAB binds ACME accounts to PD account model in v2
- Run our own `step-ca` for `*.users.portdaddy.dev` to avoid Let's Encrypt rate-limit coupling; Let's Encrypt is fine for users bringing their own domain in v2

The specialist explicitly *does not* recommend ACME for v0 over OIDC for the same operational-burden reasons the pragmatic voice flagged. The required v0 amendment is to keep ACME as an additive proof method keyed to the daemon Ed25519 fingerprint and reserve `proof_metadata` for DNS names, CA/account binding, ARI/renewal windows, CAA, EAB, and BYO-domain policy.

## Consequences

**Positive**:
- v0 ships with one well-understood workload identity bootstrap (OIDC) plus one no-CA self-hosted/harbor-local escape hatch (admin-approved WoT).
- CI runners (GH Actions) get identity for free; no provisioning cost for adopters.
- Developer daemon bootstrap can use GitHub-backed OIDC only after a concrete device/browser login exchange is implemented; until then, daemon enrollment uses the explicit admin-approved WoT lane.
- Card lifecycle is bounded: OIDC tokens expire in minutes; PD cards minted from them inherit ≤1h expiry per Phase 2 contract.
- Path to ACME (v1) and self-hosted OIDC issuers (v2) is documented and additive.
- Identity registry data model accommodates the three general proof methods plus the narrowly scoped operator-provisioned service-actor method.
- Phase 3 attenuation (ADR forthcoming) composes over PD cards regardless of how they were bootstrapped, so PKI choice is decoupled from the attenuation layer.

**Negative**:
- v0 has a single populated OIDC issuer dependency on GitHub. Outages block new workload exchanges after cached cards expire. Multi-issuer support is configured-but-empty until v1.
- Daemons that want long-term name-bound identity (e.g., `dev.example.com`-bound) wait for v1 ACME.
- Air-gap deployments must self-host the relay, configure `--auth-mode=wot`, distribute keypairs out-of-band, and maintain an admin-approved fingerprint allowlist or pairing-receipt store — a real operational ask for that audience.
- OIDC issuers rotate JWKS; relay must implement caching with bounded staleness (10-minute TTL, 1-hour fail-soft window per `pki-options-oidc.md`).
- One more CWE-345 surface (`aud` validation) to get exactly right and audit.

**Reversibility**:
- **Cost to switch primary bootstrap later**: low. Add ACME issuance endpoint; existing OIDC daemons coexist. No DB migration; `proof_method` enum already supports both.
- **Cost to revoke OIDC trust if compromised**: medium. Allowlist is config, but the relay must disable stale JWKS acceptance, bulk revoke by issuer/time window, and force re-bootstrap through admin-approved WoT or a different issuer.
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
| 1 | Identity registry schema: `(fingerprint, identifier, proof_method, proof_metadata, exp, revoked_at)` plus proof issuer/JTI/iat or minted-at metadata; later migrations may add operator-provisioned managed service identities | 0.25w | — |
| 2 | OIDC verifier: JWKS fetch + cache + signature verify + exact `aud`/`exp`/`iss`/`nbf` checks; disabled issuers bypass cached JWKS | 0.5w | (1) |
| 3 | OIDC → PD card exchange endpoint (`/v1/exchange`); fail-closed claim → cap mapping; rate limits per issuer claim; issuer/time-window bulk revocation | 0.5w | (2) |
| 4 | GitHub Actions OIDC integration test using a real GH Actions runner | 0.25w | (3) |
| 5 | `--auth-mode=wot` mode: self-hosted/harbor-local only; admin-approved fingerprint allowlist or signed pairing receipt; visible fingerprint verification and nuke-and-rekey documentation | 0.5w | (1) |
| 6 | Documentation: relay deployment guide, OIDC setup walkthrough, WoT mode security warnings | 0.25w | (3), (5) |
| **v0 total** | | **~2.25 weeks** | |
| 7 (v1) | `step-ca` ACME deployment for `*.users.portdaddy.dev`; ACME enrollment endpoint; daemon ACME client | 2w | v0 |
| 8 (v1) | Multi-issuer OIDC: GitLab + Google issuer configs and integration tests | 0.5w | v0 |
| 9 (v2) | Self-hosted OIDC issuer support: configurable issuer registry, docs, SSO walkthrough | 1w | v1 |
| 10 (v2) | Bring-your-own-domain ACME with EAB to PD account | 1w | v1 |

## Migration

There is no installed base of relay-bootstrapped daemons to migrate. New workload publishers enrolling against the v0 relay use OIDC by default. Daemon enrollment uses the explicit developer OIDC/device-login flow once implemented; otherwise daemon enrollment uses the admin-approved WoT lane. Air-gap deployments configure `--auth-mode=wot` at relay-install time and remain self-hosted/harbor-local in v0. Existing local-only daemons (no relay) are unaffected by this ADR.

## Threat-Model Invariant Mapping

This decision preserves or weakens these invariants from `references/threat-model.md`:

| Invariant | Effect under this decision |
|-----------|---------------------------|
| I1 (relay never sees plaintext) | **Preserved.** PKI is orthogonal to E2E. |
| I2 (subscribers detect equivocation) | **Preserved.** Per-publisher Merkle chain is independent of identity bootstrap. |
| I3 (stolen card bounded by exp/cap/aud) | **Preserved and strengthened.** OIDC tokens have minute-scale expiry; PD cards minted from them inherit ≤1h cap. |
| I4 (attenuation never expands rights) | **Preserved.** Phase 3 verifier is unchanged. |
| I5 (loss of relay does not lose past evidence) | **Preserved.** Chain anchoring is independent. |
| I6 (revocation ≤5s) | **Preserved with a new requirement.** Card revocation remains ≤5s, and OIDC issuer compromise recovery requires revoke-all-by-issuer-and-time with the same broadcast target. |
| I7 (AuthN ≠ AuthZ) | **Preserved with a new requirement.** OIDC = AuthN; PD card cap[] = AuthZ; unrecognized or ambiguous claims reject instead of auto-creating namespaces. |
| I8 (identity registry update requires proof) | **Preserved after revision.** OIDC token signature is proof; ACME DNS-01 will be proof; v0 WoT requires explicit admin allowlist or signed pairing receipt and is self-hosted/harbor-local only; operator-provisioned service identities require the Relay operator credential and subsequently prove private-key possession on every signed publish. |

No invariants are intentionally weakened after these acceptance conditions. Adversary A8 (compromised PKI authority) gains a new attack surface (the GitHub OIDC issuer), so the v0 implementation must ship issuer disablement, JTI auditability, cached-JWKS bypass on compromise, and bulk card revocation by issuer/time window.

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

- For v1 ACME, do we mint the user's daemon identity on `<user>.users.portdaddy.dev` automatically at first daemon startup, or require explicit opt-in to "I want a name"?
- Does the relay need to support OIDC token-binding (RFC 8471) at any point, or is short token lifetime sufficient?
- What is the exact developer daemon OIDC/device-login UX, and does it ship in v0 or stay behind the admin-approved WoT lane until a follow-up?

These do not block v0; capture as follow-ups in the next ADRs.
