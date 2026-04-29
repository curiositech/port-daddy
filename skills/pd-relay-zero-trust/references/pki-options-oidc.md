# PKI Option: OIDC (with GitHub OIDC as the canonical case)

**Load when**: OIDC is a candidate in the PKI decision, or you need to wire CI/CD identity (where OIDC is essentially mandatory).

## Summary

OIDC (OpenID Connect) is OAuth 2.0 + identity claims. The relevant superpower for us is that **major workload runtimes already mint signed identity tokens for free**:

- GitHub Actions: `ACTIONS_ID_TOKEN_REQUEST_URL` + JWT signed by GitHub's OIDC issuer
- GitLab CI: `CI_JOB_JWT`
- Google Cloud / AWS / Azure: workload identity federation
- Buildkite, CircleCI, etc.: similar OIDC integrations

A relay that accepts these tokens gets identity for any CI runner without provisioning credentials. That's a huge UX win.

For human developers, OIDC means delegating login to GitHub / Google / a corporate IdP, which most developers already have.

## What we'd actually build

A relay endpoint that:

1. Accepts a JWT signed by a known OIDC issuer.
2. Verifies signature against the issuer's published JWKS.
3. Validates `iss`, `aud` (must include our relay), `exp`, `nbf`.
4. Maps claims to capabilities (e.g., `repository_owner: erichowens` → can publish to `erichowens:*` channels).
5. Issues a short-lived **PD-issued harbor card** in exchange. The PD card is what flows on the wire from then on; OIDC is the bootstrap.

## Pros

- **CI runner identity for free.** No secrets to provision. This alone is enormous.
- **Human SSO for free.** Users log in with GitHub/Google.
- **Familiar.** Every developer has used OIDC even if they don't know it by name.
- **Revocation via short token lifetimes.** GitHub tokens are minutes-long; our exchange just doesn't refresh.
- **Composes cleanly with attenuation.** OIDC bootstrap → PD card → Phase 3 attenuated card downstream.

## Cons

- **Vendor coupling.** "GitHub is our auth" makes self-hosters and air-gapped users unhappy.
- **JWKS rotation surprises.** Issuers rotate keys; relay must re-fetch JWKS or break.
- **Audience binding subtleties.** Misconfigured `aud` validation has historically allowed token re-use across services. This is well-documented and well-attacked.
- **No built-in name-binding to keys.** OIDC says who you are, not what key you control. We have to mint a PD card to bridge.
- **Token bloat.** GitHub OIDC tokens are >2KB; passing them on every event is wasteful (mitigated by exchange to PD card).
- **Discovery and trust setup.** Relay needs a configured allowlist of acceptable issuers.

## GitHub OIDC specifics (most likely first integration)

Token claims we care about:
- `iss`: `https://token.actions.githubusercontent.com`
- `sub`: `repo:erichowens/port-daddy:ref:refs/heads/main` (or environment-scoped)
- `repository`, `repository_owner`, `repository_id`
- `actor`, `actor_id`
- `workflow`, `workflow_ref`
- `environment`, `runner_environment`
- `aud`: configurable per-call

Mapping to PD capabilities:
- `repository_owner == <your-PD-account>` → eligible for that account's namespaces
- `environment == "production"` → can map to higher-privilege channels
- `workflow_ref` → trace which workflow published

We **must** require explicit `aud` per call (`audience: relay.portdaddy.dev/<account>`) to prevent confused deputy.

## Operational notes

- **JWKS caching**: 10-minute TTL with fail-soft on issuer downtime (use last-known JWKS for an hour, then refuse).
- **Issuer allowlist**: explicit, in relay config. Adding a new issuer is a config change, not runtime.
- **Token-to-card exchange endpoint**: rate-limited per issuer claim to prevent abuse.
- **Audit log**: store the OIDC `jti` of every exchange so a leaked GitHub token can be retroactively traced.

## Pros for hybrid with ACME

- ACME = long-lived daemon identity bound to a name
- OIDC = short-lived workload/human identity bound to an issuer's claim

Together they cover the matrix:
- Daemon on developer laptop (long-lived, name-bound) → ACME
- GH Actions runner (short-lived, ephemeral) → OIDC
- Human web login (interactive, browser) → OIDC

## Anti-patterns

- **Trusting the OIDC token everywhere.** It's the bootstrap. Convert to a PD card at the perimeter.
- **Wildcard `aud`.** Always require explicit relay-specific audience.
- **No issuer allowlist.** "Accept any OIDC token" is "accept any login from anywhere."
- **Long-lived exchange.** PD card from OIDC should be the same ≤1h as a regular card. Don't issue daily tokens.
- **OIDC for user payment / billing identity.** Different concern; don't conflate.

## Self-hosting / air-gap path

For users who reject GitHub-as-IdP:
- **Self-hosted OIDC issuer** (Keycloak, Authentik, Dex). Same protocol, their domain.
- **No-OIDC fallback**: ACME-only mode where relay accepts only ACME-bound identities. Loses CI ergonomics.
- **mTLS-only mode**: for fully air-gapped relays, do not use OIDC at all; use mutually-signed client certs from a private CA.

## Implementation effort estimate

- v0 GitHub OIDC only: **~1.5 weeks** (JWKS verifier + claim mapper + exchange endpoint + audit log)
- v1 + Google + GitLab: **+0.5 week**
- v2 self-hosted issuer support: **+1 week** (configurable issuer registry, docs)

## Decision criteria scoring

OIDC tends to score: **very high on CI/CD ergonomics and human SSO; lower on air-gap fit, vendor independence, and crypto-key-binding clarity.**

## Reading list

- **OpenID Connect Core 1.0**
- **RFC 9068** — JWT Profile for OAuth 2.0 Access Tokens
- **GitHub Actions OIDC documentation** — `actions/oidc` reference
- **draft-ietf-oauth-security-topics** — current best practices for OAuth security
- **CWE-345 / Confused Deputy** — read before designing audience validation
- Salt Labs' OAuth audits (write-ups of real misconfigurations) — useful negative examples
