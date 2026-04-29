# PKI Option: ACME (RFC 8555 + extensions)

> **Status (2026-04-27)**: Input to **[ADR-0025 (Relay PKI Decision)](../../../docs/adr/0025-pki-decision.md)** which adopted an OIDC-first hybrid (OIDC v0; ACME v1; WoT escape hatch from day 1). This document is preserved as the option analysis behind that decision and is the canonical reference for **when ACME lands in v1**.

**Load when**: ACME is a candidate in the PKI decision (it usually is).

## Summary

ACME (Automated Certificate Management Environment, RFC 8555) is the protocol behind Let's Encrypt and the broader free-CA ecosystem. We would use it not for TLS server certs (we already have those via the relay's hostname), but to bind **a daemon's Ed25519 key to a verifiable real-world identifier** — usually a domain.

In practice that means: *if you control `dev.example.com`, the relay accepts a card whose issuer fingerprint is bound to that domain via an ACME challenge.*

## Variants relevant to us

| Variant | What it solves | Cost |
|---------|----------------|------|
| **DV (HTTP-01)** | Prove control of an HTTP origin | Requires a port-80 reachable origin per identity |
| **DV (DNS-01)** | Prove control of a DNS zone via TXT record | Best for headless / multi-host; needs DNS API |
| **DV (TLS-ALPN-01)** | Prove control over TLS port | Niche; useful when only 443 is open |
| **ACME-CAA** (RFC 8659) | DNS records authorize specific CAs | Hardening, not identity |
| **ARI** (Automated Renewal Information, draft-ietf-acme-ari) | CA-driven renewal scheduling | Operational lubricant; required for cert lifecycles < 90d |
| **EAB (External Account Binding)** | Bind ACME account to an external IdP | Useful if we layer ACME under our own account model |
| **ACME-ALPN with Ed25519** | Issue Ed25519 certs (RFC 8420) | Required since we don't want RSA on dev machines |

## What we'd actually build

The relay (or a sidecar) would expose an **ACME-aware enrollment endpoint**:

1. Daemon generates Ed25519 keypair (already does).
2. Daemon submits an ACME order for a *Subject Alternative Name* of either:
   - A user-controlled domain (`dev-erichs.example.com`), or
   - A subdomain under our managed zone (`erichs.users.portdaddy.dev`).
3. Daemon completes DNS-01 (or HTTP-01) challenge.
4. Relay records: `(daemon_fingerprint, identifier, expiry)`.
5. Relay accepts cards from `daemon_fingerprint` thereafter; refuses on revocation/expiry.

The cert itself is mostly a record-keeping artifact — we don't use the X.509 chain for in-band trust. We use the ACME challenge as **proof of possession of a name**, and bind the name to the daemon's Ed25519 key in the relay's identity registry.

## Pros

- **Battle-tested protocol.** RFC 8555 is broadly implemented; there are ACME clients in every language.
- **Free issuance.** Let's Encrypt and ZeroSSL eliminate cost.
- **Strong identity binding.** Domain control is a well-understood, third-party-attestable claim.
- **Familiar to ops engineers.** Anyone running web services has done ACME.
- **No vendor lock-in to a single IdP.** Users can use any ACME CA.
- **Composes with our own subdomain.** We can run an ACME CA for `*.users.portdaddy.dev` so users without their own domain still get strong identity.

## Cons

- **Requires DNS or HTTP control.** Pure local-only developers (laptops, no domain) need our managed subdomain — re-introducing us as a dependency.
- **Cert renewal complexity.** Even with ARI, daemons need a renewal scheduler. New surface for bugs.
- **Doesn't authenticate humans.** ACME proves you control a name, not that you are who you say you are. For team scenarios, we still need an out-of-band onboarding step.
- **Issuance latency.** ACME orders can take seconds to minutes; bad for ephemeral CI runners.
- **Unsuited for short-lived agents.** ACME is designed for cert lifecycles of weeks; CI agents live for minutes.

## Operational notes

- **Run our own ACME server** (e.g., `step-ca` in ACME mode) for `*.users.portdaddy.dev` rather than depending on Let's Encrypt rate limits.
- **DNS-01 only** on the managed subdomain to avoid HTTP-port requirements.
- **ARI is mandatory** if we shorten cert lifetimes below 90 days.
- **EAB binds ACME account to a PD account** if we layer billing/identity above.
- **CAA records** on `users.portdaddy.dev` lock issuance to our ACME CA.

## Where ACME fits in a hybrid

ACME proves "this key belongs to this name." It does not prove "this human authorized this action." A common hybrid:

- ACME for *daemon* identity (long-lived, name-bound)
- OIDC for *human* and *short-lived agent* identity (CI runners, GH Actions)

See `pki-options-oidc.md` for the OIDC piece.

## Anti-patterns

- **Using ACME-issued certs in TLS handshakes between daemon and relay.** Don't. The relay's TLS hostname uses a normal cert. ACME here is for *name binding into our identity registry*, not for transport trust.
- **Free-tier rate limit dependence on Let's Encrypt.** A growth spike will hit limits. Run our own ACME CA.
- **Issuing for `localhost` or `*.local`.** Public CAs refuse. Use a managed subdomain or a private ACME CA.

## Required external libraries / services

- ACME client: `acme.sh` (shell), `certbot` (Python), `lego` (Go), or our own RFC 8555 implementation
- DNS API access for DNS-01
- An ACME CA: Let's Encrypt OR our own `step-ca` deployment

## Implementation effort estimate

- v0 with managed subdomain only: **~2 weeks** (ACME CA deploy + enrollment endpoint + identity registry)
- v1 with bring-your-own-domain: **+1 week** (DNS-01 challenge support in client)
- v2 with EAB to PD account: **+1 week**

## Decision criteria scoring (see `pki-decision-matrix.md`)

ACME tends to score: **high on auditability, name-binding, and ecosystem maturity; low on UX for casual devs, latency for short-lived agents, and complexity for new contributors.**

## Reading list

- **RFC 8555** — ACME core
- **RFC 8657** — ACME challenge type for TLS-ALPN
- **RFC 8659** — CAA
- **RFC 8420** — Ed25519 in PKIX
- **draft-ietf-acme-ari** — Automated Renewal Information
- **draft-ietf-acme-client** — emerging client behaviour guidance
- `step-ca` documentation — for self-hosting an ACME CA
