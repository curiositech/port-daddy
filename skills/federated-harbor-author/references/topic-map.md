# Topic Map — Federated Harbor

Twelve topic clusters from the security bibliography
(`docs/shipwright/SECURITY-BIBLIOGRAPHY.md`), each mapped to which
probes (redteam) and defenses (whitehat) live in it. Author skill
uses this map to:

1. Know which prior art a section must cite.
2. Know which probes will hit a section before drafting it.
3. Know which defenses the whitehat fleet will reach for.

The redteam and whitehat skills' `topic-map.md` are the *same* twelve
clusters viewed from the opposite side. If a topic does not appear in
all three, it is incomplete.

## The twelve clusters

| # | Cluster                                                | Anchor papers (sample)                                                                                  | FH §     | Probe class | Defense class |
|---|--------------------------------------------------------|---------------------------------------------------------------------------------------------------------|----------|-------------|---------------|
| 1 | Formal protocol verification (Dolev-Yao, Lowe, ProVerif, Tamarin) | Dolev-Yao 1983; Lowe 1997; Blanchet 2016 ProVerif; Meier et al. 2013 Tamarin                            | §fh-3, §fh-6 | 1, 2, 6     | 1, 2, 6       |
| 2 | Capability tokens (Macaroons, UCAN, Cap'n Proto)       | Birgisson et al. 2014 Macaroons; UCAN spec; Karp et al. on E/Caja                                       | §fh-3    | 2           | 2             |
| 3 | Approximate-membership data structures (Bloom, Cuckoo) | Bloom 1970; Fan et al. 2014 Cuckoo                                                                       | §fh-7    | 3           | 3 (revocation gossip) |
| 4 | Gossip / epidemic / anti-entropy                        | Demers et al. 1987; van Renesse et al. 2003 Astrolabe                                                    | §fh-7    | 3           | 3             |
| 5 | Certificate Transparency / verifiable logs              | Laurie et al. 2013 RFC 6962; Crosby & Wallach 2009                                                       | §fh-4    | 6           | 6             |
| 6 | Sybil and identity                                      | Douceur 2002 Sybil; SybilGuard 2006; Garfinkel-Rosenblum 2005                                            | §fh-4 (sub: federation), §fh-8 | 4, 9        | 4, 9          |
| 7 | Mechanism design and information economics              | Akerlof 1970; Rothschild-Stiglitz 1976; Vickrey 1961; Myerson 1981                                       | §fh-8    | 4, 7, 8     | 4, 7, 8       |
| 8 | Cross-domain settlement / atomic swaps                  | Herlihy 2018 atomic cross-chain swaps; Zamyatin et al. 2021 SoK                                          | §fh-6    | 5           | 5             |
| 9 | Federated KMS / web-of-trust / SPKI-SDSI                | Zimmermann 1995 PGP; Maurer 1996 PKI calculus; SPKI/SDSI RFCs                                            | §fh-2, §fh-5 | 1           | 1             |
| 10| Federated identity at scale (SAML, Shibboleth, OpenID)  | Chadwick on PERMIS; SAML/Shibboleth historical concentration analysis; OpenID Federation 1.0 spec        | §fh-8    | 9           | 9             |
| 11| Capability-federation systems (Spritely Goblins, KeyKOS)| Lemmer-Webber / Tallman on Goblins; Miller / Karp / Close on E and Caja                                   | §fh-5    | 1, 2        | 1, 2          |
| 12| Supply-chain provenance (Sigstore, in-toto, SLSA)       | Newman et al. 2022 Sigstore; Torres-Arias et al. 2019 in-toto; SLSA v1.0                                  | §fh-4    | 6           | 6             |

## Drafting decisions per cluster

### Cluster 1 — Formal protocol verification

A §fh-3 or §fh-6 draft that does not name ProVerif or Tamarin in the
mechanization commitment is incomplete. The author skill cites the
Dolev-Yao adversary by name in §1's threat-model paragraph.

### Cluster 2 — Capability tokens

The author's pre-emptive analogy (per whitehat SKILL §"Pre-emptive
analogies"): *"Cross-harbor capability tokens :: Macaroons; the
Federated Harbor adds cross-harbor epoch binding."* Inline as a
sidenote in §fh-3 when the cross-harbor token is introduced.

### Cluster 3 / 4 — Cuckoo + gossip

§fh-7 (revocation across domains) cites the cuckoo filter paper plus
the canonical anti-entropy reference. The figure for §fh-7 shows the
*adversarial* gossip path next to the happy-path one (cardinal-sin
"fake simplicity" prevention).

### Cluster 5 — Certificate Transparency

§fh-4 (federated evidence trail) is structurally CT-with-bonds. The
author skill explicitly calls out the addition (bonds on witness
honesty; CT does not bond witnesses).

### Cluster 6 — Sybil and identity

§fh-4 (cross-harbor Sybil) and §fh-8 (operator Sybil) are *different*
Sybil layers. The author skill must distinguish "harbor-layer Sybil"
from "operator-layer Sybil" in the running text, not assume the
reader makes the distinction.

### Cluster 7 — Mechanism design

The Rothschild-Stiglitz separating equilibrium is the direct
foundation for §fh-8 cold-start admission. Cite by name. Youle's
contribution lives here.

### Cluster 8 — Cross-domain settlement

§fh-6 is HTLC-shaped. Pre-emptive analogy: *"Cross-domain settlement
:: HTLC atomic swaps; the Federated Harbor adds three-harbor
dispute."* HTLCs are two-party; FH adds the third role.

### Cluster 9 — Federated KMS / web-of-trust / SPKI-SDSI

The author skill commits to the SPKI/SDSI naming pattern (non-
transitive trust by explicit local attestation) as the structural
analog. §fh-5 trust transitivity uses this vocabulary.

### Cluster 10 — Federated identity at scale

§fh-8 owes the reader an honest engagement with why every prior
federated identity system at scale concentrated. The author skill
cites the historical record (SAML/Shibboleth IDP concentration) by
name, not in passing.

### Cluster 11 — Capability-federation systems

Spritely Goblins and the Miller/Karp/Close OCap lineage are the
nearest existing work. The author cites them in §fh-2 (Federated
Authority) and §fh-5 (Trust Transitivity) and explicitly names the
differentiator: the *economic* layer. Spritely is structural; FH
adds bonds.

### Cluster 12 — Supply-chain provenance

§fh-4 ties to Sigstore / in-toto / SLSA as a parallel-track
construction. The author cites them as *compose-with*, not
*replace-with*. The bonded-commons additions are explicit.

## Anti-patterns

- Drafting a section in cluster 7 without citing Rothschild-Stiglitz.
- Drafting §fh-6 without naming HTLC by name.
- Drafting §fh-4 without naming Certificate Transparency by name.
- Drafting §fh-8 without naming the SAML/Shibboleth historical
  concentration record.
- Inventing prior art. If the cluster does not list a reference, do
  not invent one; flag for the bibliography update first.
