# ADR-0022. Relay v0 Architecture

## Status

Proposed (depends on ADR-0021)

## Context

PD daemons today coordinate locally. Users want to federate events between machines: dev laptop ↔ CI runner ↔ team bot ↔ third-party SaaS. Building this as direct daemon-to-daemon (Part XVII of V4-DAG, ~1,500 LOE) is the wrong scope (see ADR-0023).

We need a cloud-side fabric that:
- Routes events between authenticated daemons and external publishers
- Stays outbound-only from the daemon (no inbound holes through user firewalls)
- Sees only ciphertext (E2E)
- Provides per-publisher Merkle non-equivocation
- Starts simple (single-region, trusted-but-minimized) and grows

## Decision

Build **Relay v0** with the following surface:

- **Transport**: HTTPS + Server-Sent Events. TLS 1.3.
- **Auth**: Ed25519 harbor cards (Phase 2) at the wire; Phase 3 attenuation for delegated publishers.
- **Identity bootstrap**: per ADR-0021.
- **Namespacing**: `<harbor_fingerprint>:<channel>` where `harbor_fingerprint = SHA256(harbor_pub_key)`.
- **E2E payload**: AES-256-GCM with HPKE-wrapped per-channel keys; relay sees ciphertext only.
- **Integrity**: per-publisher Merkle event chains; signed periodic chain heads with optional external anchoring.
- **Storage**: Cloudflare D1 + Durable Objects (managed) OR SQLite (self-host).
- **Retention**: 7 days for events, indefinite for chain heads.

Full spec: `references/relay-architecture.md`. OpenAPI surface: `openapi.yaml`.

## Non-Goals

- State replication between daemons
- Multi-region active-active in v0
- Federation between relays (single relay per deployment)
- Float Plan settlement on the wire (see `references/float-plans-deferred.md`)
- WebSockets / gRPC / custom transport

## Wire Format

Defined in JSON schemas:
- `schemas/relay-handshake.schema.json`
- `schemas/event-envelope.schema.json`
- `schemas/merkle-chain-head.schema.json`
- `schemas/harbor-card.schema.json`
- `schemas/attenuated-card.schema.json`

OpenAPI: `openapi.yaml`.

## Threat Model Summary

See `references/threat-model.md` for the full catalog. Highlights:

- Honest-but-curious relay: payload secrecy preserved by E2E
- Malicious relay: equivocation detected by per-publisher chain + optional external anchor
- Network on-path: TLS 1.3 baseline
- Compromised publisher: bounded by card.cap, exp, revocation
- Compromised harbor key: forward-secrecy boundary at next channel-key rotation

ProVerif extension required before any "formally verified" claims (see `references/proverif-relay-extension.md`).

## Operational Targets

- Publish-to-subscriber p50 < 200ms intra-region
- Publish throughput 1000 events/sec/harbor
- Revocation propagation ≤ 5s
- 99.9% relay availability SLO

## Decision

[Approved / Needs Revision]

## Consequences

**Positive**:
- Daemons gain federation without inbound network surface
- External publishers (CI, bots, browsers) gain a single integration point
- Existing crypto primitives (Ed25519, AES-GCM, HPKE) reused
- Path to Phase 3 attenuation for fine-grained CI delegation
- "Remote Harbor" (ADR-0023) becomes feasible without distributed sync

**Negative**:
- Operational dependency on relay availability for federation
- Trusted-but-minimized relay = single trust party for routing (bounded by E2E)
- Storage cost for retained events (7d) and indefinite heads
- New ProVerif modeling work required before formal claims

**Reversibility**:
- Daemons keep working without the relay (local-only mode unchanged)
- Self-hosted relay path preserved (single binary, SQLite)
- Wire format versioned (`v: 1`); future versions can deprecate gracefully

## Migration

- Existing daemons: opt-in to relay via `pd config set relay <url>`
- No DB migrations required for v0; relay state is on the relay side
- Feature-flagged behind `PORT_DADDY_RELAY_ENABLED=1` for first three releases

## Implementation Plan

1. **Schemas + libraries** (Week 1): `lib/relay-envelope.ts`, `lib/merkle-chain.ts`, JSON schemas in repo.
2. **Local handshake spec + verifier** (Week 2): `verify_relay_handshake.py` integration, golden vectors.
3. **Cloudflare DO prototype** (Week 3-4): one harbor → one DO → SSE fan-out.
4. **Identity registry + ACME enrollment** (Week 5-6): per ADR-0021.
5. **Phase 3 attenuation** (Week 7-8): per `references/harbor-card-attenuation.md`.
6. **ProVerif extension** (Week 7-8 in parallel): per `references/proverif-relay-extension.md`.
7. **Beta program** (Week 9-10): three external teams.
8. **GA** (Week 11+): public docs, pricing, SLA.

## Related ADRs / References

- ADR-0014 (Anchor Protocol)
- ADR-0013 (Unified Harbor Model)
- ADR-0019 (Declarative Fleet YAML)
- ADR-0021 (PKI Decision) — depends on
- ADR-0023 (V4 Remote Harbor Redefinition) — depends on this
- references/relay-architecture.md
- references/threat-model.md
- references/merkle-chain-design.md
- references/e2e-payload-encryption.md
- IPC-PROTOCOL-DESIGN.md (transport pattern parallels)

## Open Questions

- Single-region or multi-region for GA? (Recommendation: single for v0, multi for v1)
- Free tier limits? (Recommendation: 10k events/day, soft cap with notice)
- Self-host packaging? (Recommendation: docker image + SQLite for v0)
