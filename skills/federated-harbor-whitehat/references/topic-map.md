# Topic Map — Federated Harbor Whitehat View

Same twelve clusters as
`skills/federated-harbor-author/references/topic-map.md` and
`skills/federated-harbor-redteam/references/topic-map.md`. From the
whitehat's side, each cluster names *which defense class* lives in it.

The 1:1 mapping with redteam probes must be exact: each row's
"Defense class" column equals the same row's "Probe class" column in
the redteam file (modulo numbering: defense N here ↔ probe N there).

## The twelve clusters (whitehat-view)

| # | Cluster                                                | FH §     | Defense class (this skill's index-for-index)                        | Persona owner            |
|---|--------------------------------------------------------|----------|---------------------------------------------------------------------|--------------------------|
| 1 | Formal protocol verification (Dolev-Yao, Lowe, ProVerif, Tamarin) | §fh-3, §fh-6 | 1 trust-transitivity; 2 cross-harbor token forgery; 6 equivocation | trust, tokens            |
| 2 | Capability tokens (Macaroons, UCAN, Cap'n Proto)       | §fh-3    | 2 cross-harbor capability-token forgery / re-issuance / splice       | tokens                   |
| 3 | Approximate-membership data structures (Bloom, Cuckoo) | §fh-7    | 3 federated revocation propagation                                   | revocation               |
| 4 | Gossip / epidemic / anti-entropy                        | §fh-7    | 3 federated revocation propagation (continued)                       | revocation               |
| 5 | Certificate Transparency / verifiable logs              | §fh-4    | 6 equivocation between published harbor tree-heads                   | tokens                   |
| 6 | Sybil and identity                                      | §fh-4, §fh-8 | 4 cross-harbor Sybil; 9 federation-operator Sybil                    | econ                     |
| 7 | Mechanism design and information economics              | §fh-8    | 4 Sybil-cost; 7 bond-pool draining; 8 cold-start extraction          | econ                     |
| 8 | Cross-domain settlement / atomic swaps                  | §fh-6    | 5 cross-domain settlement (two-phase commit with bonded escalation)  | econ                     |
| 9 | Federated KMS / web-of-trust / SPKI-SDSI                | §fh-2, §fh-5 | 1 trust-transitivity                                                 | trust                    |
| 10| Federated identity at scale (SAML, Shibboleth)          | §fh-8    | 9 federation-operator Sybil (honest disclaimer)                       | econ                     |
| 11| Capability-federation systems (Spritely, KeyKOS, E)     | §fh-5    | 1 trust-transitivity; 2 token re-issuance                             | trust, tokens            |
| 12| Supply-chain provenance (Sigstore, in-toto, SLSA)       | §fh-4    | 6 equivocation in federated audit logs                                | tokens                   |

## Defense classes — the nine (1:1 with redteam probe classes)

1. **Non-transitive pact composition** — `fh-whitehat-trust`
2. **Three-layered token guarantees (unforgeability + epoch-binding + position-binding)** — `fh-whitehat-tokens`
3. **Bounded propagation invariant + pessimistic verifier** — `fh-whitehat-revocation`
4. **Quadratic joining bond, stake-fraction voting** — `fh-whitehat-econ`
5. **Two-phase commit with bonded escalation** — `fh-whitehat-econ`
6. **Cross-witness tree-head publication** — `fh-whitehat-tokens`
7. **Convex bond curve, pool floor refusal** — `fh-whitehat-econ`
8. **Reputation budget cap (extraction ≤ bond)** — `fh-whitehat-econ`
9. **Honest disclaimer: paper does NOT claim operator diversity** — `fh-whitehat-econ`

Plus cross-cutting:

- **Proof completion** (land artifacts flagged by the proof-gap auditor) — `fh-proof-completer`.

## Refuses-vs-prices structural table

The five-row structural defense argument from SKILL.md:

| Layer | Refuses | Prices |
|---|---|---|
| Federation identity | Unauthenticated cross-harbor token acceptance | Attestation propagation gossip |
| Federation audit | Unwitnessed tree-heads, equivocating publishers | Witness service |
| Federation collateral | Cross-harbor commitments below bond floor | Bond replenishment on convex curve |
| Federation settlement | Double-extract across harbors | Dispute latency |
| Federation governance | Voting-by-harbor-count | Stake-proportional influence |

A defense that neither refuses nor prices is not a defense; it is a
wish.

## Pre-emptive analogies (canonical)

| Federation primitive                       | Analog                              | What FH adds                          |
|--------------------------------------------|-------------------------------------|---------------------------------------|
| Federated tree-heads + cross-witness        | Certificate Transparency            | Bonds on witness honesty              |
| Cross-harbor capability tokens              | Macaroons                            | Cross-harbor epoch-binding            |
| Cross-domain settlement                     | HTLC atomic swaps                    | Three-harbor dispute                  |
| Federation pact composition                 | SPKI/SDSI naming                     | Bonded attestation                    |
| Revocation propagation under partition      | CRL/OCSP staleness (PKI)             | Pricing the stale window (slash on miss) |

Each analogy is a one-sentence sidenote in the paper plus a
two-paragraph "differences from X" section in the appendix. The
shibboleth: "Cross-witness, not centralized log." If a counter
introduces a trusted root, the doctrine has slipped.

## Anti-patterns

- Defending a cluster without naming the canonical analog.
- Closing a smell in cluster 8 without the HTLC analogy callout.
- Closing a smell in cluster 5 without the CT-cross-witness analogy.
- Counter without the refuses/prices markers.
