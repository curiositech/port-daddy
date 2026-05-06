# Reading List (Defender Slim)

Mirror of the red-team reading list, trimmed to the entries most actionable for
defenders. For the full list see
`../../redteam-review/references/reading-list.md`.

## Protocol Verification (Prove It)

1. **Lowe, G. (1997). "A hierarchy of authentication specifications."** CSFW. — Use these names in every protocol spec; defenders need vocabulary for what they are proving.
2. **Cremers & Mauw (2012). "Operational Semantics and Verification of Security Protocols."** Springer. — Tamarin foundations.
3. **Blanchet (2016). "Modeling and Verifying Security Protocols with the Applied Pi Calculus and ProVerif."** Found. & Trends. — ProVerif tutorial.
4. **Meier, Schmidt, Cremers, Basin (2013). "The TAMARIN Prover."** CAV. — Prover paper.
5. **RFC 8725 — JWT Best Current Practices.** — Mandatory for any token-shaped surface.

## JWT / Algorithm Confusion (Defenders Especially)

6. **CVE-2015-9235** — JWT alg confusion.
7. **CVE-2018-1000531** — `alg=none` acceptance in `jjwt`.
8. **McLean (2015). "Critical vulnerabilities in JSON Web Token libraries."** — Plain-English summary of the confusion family; circulate to every implementer.

## Filters and Revocation

9. **Fan et al. (2014). "Cuckoo Filter: Practically Better Than Bloom."** CoNEXT. — Read the eviction-failure regime; size filters with real headroom.
10. **Mitzenmacher (2002). "Compressed Bloom filters."** TON. — For revocation gossip bandwidth analysis.

## Gossip / Anti-Entropy

11. **Demers et al. (1987). "Epidemic Algorithms for Replicated Database Maintenance."** PODC. — Foundational; informs propagation guarantees and worst-case analysis.
12. **van Renesse et al. (2003). "Astrolabe."** TOCS. — Hierarchical gossip patterns at scale.

## Public Audit Logs

13. **Laurie, Langley, Käsper (2013). "Certificate Transparency."** RFC 6962. — Tamper-evident attestation log model.
14. **Crosby & Wallach (2009). "Efficient Data Structures for Tamper-Evident Logging."** USENIX Sec. — Merkle-log primitive.

## Sybil + Identity Defenses

15. **Douceur (2002). "The Sybil Attack."** IPTPS. — Without a trusted certifier, defenders cannot rely on identity alone.
16. **Yu et al. (2006). "SybilGuard."** SIGCOMM. — Social-graph-based Sybil resistance; relevant to federation topology design.

## Mechanism Design (Why Bonds and Auctions Help)

17. **Akerlof (1970). "The Market for Lemons."** QJE.
18. **Rothschild & Stiglitz (1976). "Equilibrium in Competitive Insurance Markets."** QJE. — *The* foundational paper for competitive bond pricing.
19. **Wilson (1977). "A Model of Insurance Markets with Incomplete Information."** JET.
20. **Vickrey (1961). "Counterspeculation, Auctions, and Competitive Sealed Tenders."** J. Finance.
21. **Myerson (1981). "Optimal Auction Design."** Math. Op. Research.
22. **Spence (1973). "Job Market Signaling."** QJE. — Costly-signal model; bonded reputation belongs to this family.
23. **Mas-Colell, Whinston, Green (1995). "Microeconomic Theory."** Oxford.
24. **Nisan, Roughgarden, Tardos, Vazirani eds. (2007). "Algorithmic Game Theory."** Cambridge.

## Distributed-Systems Foundations

25. **Lamport, Shostak, Pease (1982). "The Byzantine Generals Problem."** TOPLAS.
26. **Fischer, Lynch, Paterson (1985). FLP impossibility.** JACM. — Bounds what asynchronous coordination can promise; defenders must not advertise more.
27. **Lamport (1978). "Time, Clocks, and the Ordering of Events."** CACM. — Basis for retraction-race tiebreak.
28. **Ongaro & Ousterhout (2014). "Raft."** USENIX ATC.

## Crypto Primitives + Standards

29. **Bernstein et al. (2012). Ed25519.** J. Crypto. Eng. — Constant-time analysis; defenders use the libraries that respect it.
30. **Shamir (1979). "How to Share a Secret."** CACM. — k-of-n KMS escrow.
31. **Argon2 spec — Biryukov, Dinu, Khovratovich (2016).** — Memory-hard password hashing for recovery secrets.
32. **WebAuthn (W3C).** — Phishing-resistant second factor; the right answer to recovery-oracle attacks.
33. **NIST SP 800-208 — Stateful Hash-Based Signatures.** — Forward-looking PQ readiness.

## Side Channels

34. **Kocher (1996). "Timing Attacks."** CRYPTO. — Defenders must run constant-time code and verify it.
35. **Bernstein (2005). "Cache-timing attacks on AES."** — On why language guarantees are not hardware guarantees.

## Verification Tooling

36. **Yu, Manolios, Lamport (1999). "Model Checking TLA+ Specifications."** CHARME.
37. **Konnov, Kukovec, Tran (2019). Apalache.** OOPSLA.
38. **Holzmann (2003). "The SPIN Model Checker."** Addison-Wesley.
39. **Kani: bit-precise model checker for Rust (2022).** — Practical CI integration.

## Practice

40. **Anderson (2020). "Security Engineering," 3rd ed.** Wiley. — Protocols chapter and bonded-systems chapter.
41. **Geer (2014). "Heartbleed as Metaphor."** Lawfare. — On systemic risk in widely-used crypto code.
42. **Howard, M., LeBlanc, D. (2003). "Writing Secure Code."** Microsoft Press. — Still useful for the parser-hardening discipline.
