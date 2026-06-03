# Topic Map — Federated Harbor Redteam View

Same twelve clusters as
`skills/federated-harbor-author/references/topic-map.md` and
`skills/federated-harbor-whitehat/references/topic-map.md`. From the
redteam's side, each cluster names *which probe class* lives in it.

The 1:1 mapping with whitehat defenses must be exact: each row's
"Probe class" column must equal the same row's "Defense class" column
in the whitehat file (modulo numbering: probe N here ↔ defense N
there).

## The twelve clusters (redteam-view)

| # | Cluster                                                | FH §     | Probe class (this skill's index-for-index)                          | Persona owner            |
|---|--------------------------------------------------------|----------|---------------------------------------------------------------------|--------------------------|
| 1 | Formal protocol verification (Dolev-Yao, Lowe, ProVerif, Tamarin) | §fh-3, §fh-6 | 1 trust-transitivity; 2 cross-harbor token forgery; 6 equivocation | trust, tokens            |
| 2 | Capability tokens (Macaroons, UCAN, Cap'n Proto)       | §fh-3    | 2 cross-harbor capability-token forgery / re-issuance / splice       | tokens                   |
| 3 | Approximate-membership data structures (Bloom, Cuckoo) | §fh-7    | 3 federated revocation propagation (gossip + filter)                 | revocation               |
| 4 | Gossip / epidemic / anti-entropy                        | §fh-7    | 3 federated revocation propagation (continued)                       | revocation               |
| 5 | Certificate Transparency / verifiable logs              | §fh-4    | 6 equivocation between published harbor tree-heads                   | tokens                   |
| 6 | Sybil and identity                                      | §fh-4, §fh-8 | 4 cross-harbor Sybil; 9 federation-operator Sybil                    | econ                     |
| 7 | Mechanism design and information economics              | §fh-8    | 4 Sybil-cost; 7 bond-pool draining; 8 cold-start extraction          | econ                     |
| 8 | Cross-domain settlement / atomic swaps                  | §fh-6    | 5 cross-domain settlement (claim-A / settle-B / dispute-C)           | econ                     |
| 9 | Federated KMS / web-of-trust / SPKI-SDSI                | §fh-2, §fh-5 | 1 trust-transitivity                                                 | trust                    |
| 10| Federated identity at scale (SAML, Shibboleth)          | §fh-8    | 9 federation-operator Sybil (centralization gravity)                  | econ                     |
| 11| Capability-federation systems (Spritely, KeyKOS, E)     | §fh-5    | 1 trust-transitivity; 2 token re-issuance across systems              | trust, tokens            |
| 12| Supply-chain provenance (Sigstore, in-toto, SLSA)       | §fh-4    | 6 equivocation in federated audit logs                                | tokens                   |

## Probe classes — the nine

Index-for-index with whitehat's defense classes. **If you renumber
here, renumber there.**

1. **Trust transitivity** — `fh-redteam-trust`
2. **Cross-harbor capability-token forgery / re-issuance / splice** — `fh-redteam-tokens`
3. **Federated revocation under adversarial network** — `fh-redteam-revocation`
4. **Cross-harbor Sybil** — `fh-redteam-econ`
5. **Cross-domain settlement (claim-A / settle-B / dispute-C)** — `fh-redteam-econ`
6. **Equivocation between harbor tree-heads** — `fh-redteam-tokens`
7. **Bond-pool draining across boundaries** — `fh-redteam-econ`
8. **Cold-start joining without prior reputation** — `fh-redteam-econ`
9. **Federation-operator Sybil** — `fh-redteam-econ`

Plus cross-cutting:

- **Proof-gap audit** (every claim must have a working mechanization
  artifact) — `fh-proof-gap-auditor`.

## Probe selection logic

For each cluster, the redteam-coord picks the *first un-probed
section* and assigns the corresponding persona. If multiple sections
in a cluster are still un-probed, prefer §fh-N with `UNRESOLVED`
cross-paper rows (per `cross-paper-dependencies.md`); those are the
highest-leverage targets.

## Anti-patterns

- Probing a cluster without naming the canonical prior art in the
  smell-note. A trust-transitivity smell that does not cite
  SPKI/SDSI or Maurer is sloppy.
- Re-probing a section that is `resolved` in cross-paper deps
  without re-running the source artifact first. If the source still
  passes, your probe should target the *substitution form*, not the
  source result.
- Probing a §fh-N that the drafter has not yet marked
  `ready-for-redteam`. Wait for the spray.
