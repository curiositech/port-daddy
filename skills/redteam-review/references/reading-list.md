# Reading List

Citations grouped by topic. One-line annotations only.

## Cryptographic Protocol Verification

1. **Lowe, G. (1997). "A hierarchy of authentication specifications."** CSFW. — The canonical taxonomy: aliveness, weak agreement, non-injective agreement, injective agreement. Use these names in every protocol spec.
2. **Cremers, C., Mauw, S. (2012). "Operational Semantics and Verification of Security Protocols."** Springer. — Foundations behind Tamarin; read for the multiset-rewriting model of stateful protocols.
3. **Blanchet, B. (2016). "Modeling and Verifying Security Protocols with the Applied Pi Calculus and ProVerif."** Found. & Trends in Privacy & Security. — ProVerif tutorial and reference.
4. **Meier, S., Schmidt, B., Cremers, C., Basin, D. (2013). "The TAMARIN Prover for the Symbolic Analysis of Security Protocols."** CAV. — Tamarin paper; read alongside `tamarin-prover` tutorial.
5. **Bhargavan, K., Leurent, G. (2016). "Transcript Collision Attacks: Breaking Authentication in TLS, IKE, and SSH."** NDSS. — Why algorithm pinning matters in practice.
6. **Dolev, D., Yao, A. (1983). "On the security of public key protocols."** IEEE Trans. Inf. Theory. — Original symbolic adversary model.

## JWT / Token Confusion

7. **CVE-2015-9235** — JWT `alg=HS256` confusion against an asymmetric public key.
8. **CVE-2018-1000531** — `jjwt` `alg=none` acceptance.
9. **Tim McLean (2015). "Critical vulnerabilities in JSON Web Token libraries."** Auth0 blog. — Plain-English write-up of the alg-confusion family.
10. **RFC 8725 — "JSON Web Token Best Current Practices."** — Read this if you ship anything JWT-shaped.

## Cuckoo / Bloom Filters

11. **Fan, B., Andersen, D., Kaminsky, M., Mitzenmacher, M. (2014). "Cuckoo Filter: Practically Better Than Bloom."** CoNEXT. — The original cuckoo-filter paper; read the eviction analysis carefully.
12. **Bloom, B. (1970). "Space/time trade-offs in hash coding with allowable errors."** CACM. — Background.
13. **Mitzenmacher, M. (2002). "Compressed Bloom filters."** TON. — Useful for revocation gossip bandwidth analysis.

## Gossip / Anti-Entropy / Epidemic Algorithms

14. **Demers, A. et al. (1987). "Epidemic Algorithms for Replicated Database Maintenance."** PODC. — Foundational; defines anti-entropy + rumor-mongering tradeoffs.
15. **van Renesse, R., Birman, K., Vogels, W. (2003). "Astrolabe."** TOCS. — Hierarchical gossip for large-scale systems.
16. **Eugster, P. et al. (2004). "Epidemic Information Dissemination in Distributed Systems."** IEEE Computer. — Good survey.

## Certificate Transparency / Public Audit Logs

17. **Laurie, B., Langley, A., Käsper, E. (2013). "Certificate Transparency."** RFC 6962. — The model for verifiable, append-only attestation logs Anchor's Merkle attestation borrows.
18. **Crosby, S., Wallach, D. (2009). "Efficient Data Structures for Tamper-Evident Logging."** USENIX Sec. — Merkle-tree audit log primitive.

## Sybil and Identity

19. **Douceur, J. (2002). "The Sybil Attack."** IPTPS. — Original; without a trusted certifier, Sybil is unavoidable in open systems.
20. **Garfinkel, T., Rosenblum, M. (2005). "When Virtual Is Harder Than Real."** HotOS. — Sybil-adjacent identity-attestation issues.
21. **Yu, H., Kaminsky, M., Gibbons, P., Flaxman, A. (2006). "SybilGuard: Defending Against Sybil Attacks via Social Networks."** SIGCOMM. — Social-graph defenses; useful for federation topology.

## Mechanism Design / Information Economics

22. **Akerlof, G. (1970). "The Market for Lemons."** QJE. — Adverse selection canon.
23. **Rothschild, M., Stiglitz, J. (1976). "Equilibrium in Competitive Insurance Markets."** QJE. — Separating equilibria in insurance under asymmetric information; the *direct* foundation for competitive bond pricing.
24. **Wilson, C. (1977). "A Model of Insurance Markets with Incomplete Information."** JET. — Companion to Rothschild-Stiglitz; pooling equilibria.
25. **Vickrey, W. (1961). "Counterspeculation, Auctions, and Competitive Sealed Tenders."** J. Finance. — Second-price sealed-bid auction; truthful bidding.
26. **Myerson, R. (1981). "Optimal Auction Design."** Math. Op. Research. — Revenue-maximizing mechanisms; revelation principle.
27. **Mas-Colell, A., Whinston, M., Green, J. (1995). "Microeconomic Theory."** Oxford. — General-equilibrium grounding; chapters on adverse selection and signaling.
28. **Nisan, N., Roughgarden, T., Tardos, É., Vazirani, V. (eds., 2007). "Algorithmic Game Theory."** Cambridge. — Reference for mechanism design at the algorithm-engineer level.
29. **Roughgarden, T. (2016). "Twenty Lectures on Algorithmic Game Theory."** Cambridge. — Accessible entry point.
30. **Spence, M. (1973). "Job Market Signaling."** QJE. — Costly-signal model; relevant to bonded reputation.

## Distributed Systems Foundations

31. **Lamport, L., Shostak, R., Pease, M. (1982). "The Byzantine Generals Problem."** TOPLAS. — Read for the original setting and the impossibility bounds.
32. **Fischer, M., Lynch, N., Paterson, M. (1985). "Impossibility of Distributed Consensus with One Faulty Process."** JACM (FLP). — Required reading; sets bounds on what asynchronous coordination can promise.
33. **Lamport, L. (1978). "Time, Clocks, and the Ordering of Events in a Distributed System."** CACM. — Lamport timestamps; the basis for the pheromone-retraction tiebreak.
34. **Ongaro, D., Ousterhout, J. (2014). "In Search of an Understandable Consensus Algorithm (Raft)."** USENIX ATC. — Raft; if any control-plane state needs strong consistency.
35. **Brewer, E. (2000). "Towards Robust Distributed Systems."** PODC keynote. — CAP at a high level.

## Cryptographic Primitives and Specs

36. **Bernstein, D. et al. (2012). "High-speed high-security signatures (Ed25519)."** J. Crypto. Eng. — Read the constant-time analysis.
37. **Shamir, A. (1979). "How to Share a Secret."** CACM. — k-of-n secret sharing; basis for KMS escrow design.
38. **Biryukov, A., Dinu, D., Khovratovich, D. (2016). "Argon2: New Generation of Memory-Hard Functions for Password Hashing."** Euro S&P. — Reference for password-derived recovery secrets.
39. **W3C. "Web Authentication: An API for accessing Public Key Credentials Level 2."** WebAuthn. — The standard; phishing-resistant second factor.
40. **NIST SP 800-208. "Recommendation for Stateful Hash-Based Signature Schemes."** — If post-quantum hardness for capability tokens is on the roadmap.

## Side Channels

41. **Kocher, P. (1996). "Timing Attacks on Implementations of Diffie-Hellman, RSA, DSS, and Other Systems."** CRYPTO. — Foundational timing-attack paper.
42. **Bernstein, D. (2005). "Cache-timing attacks on AES."** Tech report. — The cache-timing canon.

## Auction / Market Simulation

43. **Cliff, D. (1997). "Minimal-intelligence agents for bargaining behaviors in market-based environments."** HP Labs / BSE — Bristol Stock Exchange. — Open-source CDA simulator; good baseline for cartel-vs-honest experiments.
44. **Tesfatsion, L. (2006). "Agent-Based Computational Economics: A Constructive Approach to Economic Theory."** Handbook of Computational Economics. — Survey; entry point for ABM-in-economics literature.
45. **Wilensky, U. (1999). "NetLogo."** Center for Connected Learning. — Reference for the NetLogo platform.
46. **Masad, D., Kazil, J. (2015). "Mesa: An Agent-Based Modeling Framework."** Proc. SciPy. — Mesa origin paper.

## Verification Tooling Specifics

47. **Yu, Y., Manolios, P., Lamport, L. (1999). "Model Checking TLA+ Specifications."** CHARME. — TLC algorithm; read once before betting a system on TLA+.
48. **Konnov, I., Kukovec, J., Tran, T.-H. (2019). "TLA+ Model Checking Made Symbolic."** OOPSLA (Apalache). — When TLC can't reach the state space.
49. **Holzmann, G. (2003). "The SPIN Model Checker."** Addison-Wesley. — The reference text.
50. **Kyjac, R. et al. (2022). "Kani: A Bit-Precise Model Checker for Rust."** — Kani usage and theory.

## Process / Practice

51. **Geer, D. (2014). "Heartbleed as Metaphor."** Lawfare. — On systemic risk in widely-used crypto code.
52. **Anderson, R. (2020). "Security Engineering," 3rd ed.** Wiley. — Chapter on protocols; chapter on banking and bonded systems is directly relevant.
