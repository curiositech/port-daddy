# Security Bibliography — Shipwright Threat Model

Authoritative seminal-paper bibliography for the threat model, covering:
formal cryptographic-protocol verification, capability tokens, approximate
membership data structures, gossip / epidemic protocols, certificate
transparency, mechanism design and information economics, Sybil-resistance,
secret sharing, WebAuthn / FIDO2, password hashing, and distributed
consensus.

Each entry: full bibliographic detail, DOI / canonical URL (search-verified
where possible; WebFetch was denied in this environment, so URLs are taken
from search results without retrieval), and a one-sentence relevance to the
Shipwright design (capability tokens with Ed25519 attenuation + cuckoo
revocation gossip; bonded commons + competitive insurance; federated KMS
with passkey pairing, Argon2 key wrapping, magic-link recovery, and a
Merkle-forest evidence ledger).

Entries marked `[unverified]` flag a specific identifier I could not
cross-confirm via search snippets.

---

## 1. Formal verification of security protocols

1. **Dolev, D.; Yao, A. C.** "On the Security of Public Key Protocols."
   *IEEE Transactions on Information Theory* 29(2): 198–208, March 1983.
   DOI: 10.1109/TIT.1983.1056650.
   URL: https://ieeexplore.ieee.org/document/1056650/ —
   Defines the canonical symbolic-attacker model used to reason about every
   cryptographic protocol in this design.

2. **Lowe, G.** "A Hierarchy of Authentication Specifications."
   *Proc. 10th IEEE Computer Security Foundations Workshop (CSFW '97)*,
   pp. 31–44, June 1997.
   URL: https://conferences.computer.org/sp/pdfs/csf/1997/1997-lowe-hierarchy.pdf —
   Formalizes the four authentication strengths (aliveness, weak agreement,
   non-injective agreement, injective agreement) we use to specify what
   capability holders prove to verifiers.

3. **Blanchet, B.** "Modeling and Verifying Security Protocols with the Applied
   Pi Calculus and ProVerif." *Foundations and Trends in Privacy and Security*
   1(1–2): 1–135, 2016. DOI: 10.1561/3300000004.
   URL: https://bblanche.gitlabpages.inria.fr/publications/BlanchetFnTPS16.pdf —
   Definitive ProVerif reference; the tool of choice for proving secrecy /
   authentication of the capability protocol against unbounded sessions.

4. **Meier, S.; Schmidt, B.; Cremers, C.; Basin, D.** "The TAMARIN Prover
   for the Symbolic Analysis of Security Protocols." *Computer Aided
   Verification (CAV 2013)*, LNCS 8044, pp. 696–701.
   DOI: 10.1007/978-3-642-39799-8_48.
   URL: https://link.springer.com/chapter/10.1007/978-3-642-39799-8_48 —
   Tamarin's launching paper; preferred over ProVerif when state and
   revocation matter (it does for our chained tokens).

5. **Cremers, C.; Horvat, M.; Hoyland, J.; Scott, S.; van der Merwe, T.**
   "A Comprehensive Symbolic Analysis of TLS 1.3." *ACM CCS 2017*,
   pp. 1773–1788. DOI: 10.1145/3133956.3134063.
   URL: https://acmccs.github.io/papers/p1773-cremersA.pdf —
   Reference example of Tamarin applied to a complex layered real-world
   protocol — the modeling pattern we should follow.

6. **Cremers, C.; Horvat, M.; Scott, S.; van der Merwe, T.** "Automated
   Analysis and Verification of TLS 1.3: 0-RTT, Resumption and Delayed
   Authentication." *IEEE S&P 2016*, pp. 470–485.
   URL: https://ieeexplore.ieee.org/document/7546518/ —
   Earlier Tamarin TLS 1.3 model; relevant for analyzing token resumption /
   replay across sessions.

## 2. Capability tokens

7. **Birgisson, A.; Politz, J. G.; Erlingsson, Ú.; Taly, A.; Vrable, M.;
   Lentczner, M.** "Macaroons: Cookies with Contextual Caveats for
   Decentralized Authorization in the Cloud." *NDSS 2014*.
   URL: https://www.ndss-symposium.org/ndss2014/ndss-2014-programme/macaroons-cookies-contextual-caveats-decentralized-authorization-cloud/ —
   The construction our Ed25519 multi-hop attenuation chain is modeled on.

## 3. Approximate-membership data structures

8. **Bloom, B. H.** "Space/Time Trade-offs in Hash Coding with Allowable
   Errors." *Communications of the ACM* 13(7): 422–426, July 1970.
   DOI: 10.1145/362686.362692. URL: https://dl.acm.org/doi/10.1145/362686.362692 —
   The Bloom filter origin paper; ancestor of the cuckoo filter we use for
   revocation.

9. **Pagh, R.; Rodler, F. F.** "Cuckoo Hashing." *European Symposium on
   Algorithms (ESA 2001)*, LNCS 2161, pp. 121–133. Journal version:
   *Journal of Algorithms* 51(2): 122–144, May 2004.
   URL: https://www.brics.dk/RS/01/32/BRICS-RS-01-32.pdf —
   Worst-case-O(1) lookup hashing scheme; the substrate of cuckoo filters.

10. **Fan, B.; Andersen, D. G.; Kaminsky, M.; Mitzenmacher, M. D.** "Cuckoo
    Filter: Practically Better Than Bloom." *ACM CoNEXT 2014*, pp. 75–88.
    DOI: 10.1145/2674005.2674994.
    URL: https://www.cs.cmu.edu/~dga/papers/cuckoo-conext2014.pdf —
    Defines the cuckoo filter; supports deletion (which Bloom does not),
    enabling our gossip-distributed revocation set.

## 4. Gossip / epidemic protocols and consensus

11. **Demers, A.; Greene, D.; Hauser, C.; Irish, W.; Larson, J.; Shenker,
    S.; Sturgis, H.; Swinehart, D.; Terry, D.** "Epidemic Algorithms for
    Replicated Database Maintenance." *PODC 1987 / Operating Systems
    Review* 22(1): 8–32, January 1988.
    DOI: 10.1145/43921.43922. URL: https://dl.acm.org/doi/10.1145/43921.43922 —
    The original anti-entropy + rumor-mongering paper from Xerox PARC; the
    literal basis of our gossip layer for revocation distribution.

12. **Lamport, L.** "The Part-Time Parliament." *ACM Transactions on
    Computer Systems* 16(2): 133–169, May 1998.
    DOI: 10.1145/279227.279229. URL: https://dl.acm.org/doi/10.1145/279227.279229 —
    Paxos: foundational consensus algorithm; the "what would total order
    cost?" baseline against which we choose gossip.

13. **Ongaro, D.; Ousterhout, J.** "In Search of an Understandable
    Consensus Algorithm." *USENIX ATC 2014*, pp. 305–319.
    URL: https://www.usenix.org/conference/atc14/technical-sessions/presentation/ongaro —
    Raft: easier-to-implement consensus; likely substrate for any
    strongly-consistent subsystem (e.g. evidence-ledger STH publication).

14. **Fischer, M. J.; Lynch, N. A.; Paterson, M. S.** "Impossibility of
    Distributed Consensus with One Faulty Process." *Journal of the ACM*
    32(2): 374–382, April 1985.
    DOI: 10.1145/3149.214121. URL: https://dl.acm.org/doi/10.1145/3149.214121 —
    FLP: rules out deterministic asynchronous consensus with even one
    crash failure; explains why we can't both gossip and guarantee
    linearizability.

## 5. Certificate Transparency / evidence-ledger pattern

15. **Laurie, B.; Langley, A.; Kasper, E.** "Certificate Transparency."
    RFC 6962, IETF, June 2013.
    URL: https://www.rfc-editor.org/rfc/rfc6962.html —
    The append-only Merkle log + SCT + audit/consistency-proof design our
    Merkle-forest evidence ledger inherits.

## 6. Information economics, mechanism design, auctions

16. **Akerlof, G. A.** "The Market for 'Lemons': Quality Uncertainty and
    the Market Mechanism." *Quarterly Journal of Economics* 84(3): 488–500,
    August 1970.
    URL: https://academic.oup.com/qje/article-abstract/84/3/488/1896241 —
    Founds adverse-selection theory; the canonical reason transaction
    insurance pools collapse without screening.

17. **Rothschild, M.; Stiglitz, J.** "Equilibrium in Competitive Insurance
    Markets: An Essay on the Economics of Imperfect Information."
    *Quarterly Journal of Economics* 90(4): 629–649, November 1976.
    URL: https://academic.oup.com/qje/article-abstract/90/4/629/1886620 —
    The reference equilibrium analysis (and non-existence result) for
    competitive insurance over heterogeneous risks; the model we are
    deliberately invoking.

18. **Wilson, C.** "A Model of Insurance Markets with Incomplete
    Information." *Journal of Economic Theory* 16(2): 167–207, December 1977.
    URL: https://ideas.repec.org/a/eee/jetheo/v16y1977i2p167-207.html —
    Anticipatory equilibrium that resolves Rothschild–Stiglitz
    non-existence; the equilibrium concept we should target.

19. **Vickrey, W.** "Counterspeculation, Auctions, and Competitive Sealed
    Tenders." *Journal of Finance* 16(1): 8–37, March 1961.
    DOI: 10.1111/j.1540-6261.1961.tb02789.x.
    URL: https://onlinelibrary.wiley.com/doi/abs/10.1111/j.1540-6261.1961.tb02789.x —
    Founding auction-theory paper; second-price auction and revenue
    equivalence.

20. **Myerson, R. B.** "Optimal Auction Design." *Mathematics of Operations
    Research* 6(1): 58–73, February 1981.
    DOI: 10.1287/moor.6.1.58. URL: https://dl.acm.org/doi/10.1287/moor.6.1.58 —
    Optimal-auction characterization; the right lens for designing the
    insurer-bidding round of the bonded commons.

## 7. Sybil attack and identity

21. **Douceur, J. R.** "The Sybil Attack." *International Workshop on
    Peer-to-Peer Systems (IPTPS 2002)*, LNCS 2429, pp. 251–260, March 2002.
    DOI: 10.1007/3-540-45748-8_24.
    URL: https://www.microsoft.com/en-us/research/publication/the-sybil-attack/ —
    Establishes the impossibility of Sybil-resistance without a logically
    centralized authority or strong resource-parity assumption; framing for
    why bonds-on-entry are our chosen Sybil-resistance.

22. **Garfinkel, T.; Rosenblum, M.** "When Virtual Is Better Than Real."
    *HotOS VIII*, May 2001 — and follow-on work by these authors on
    identity and trusted execution.
    URL: https://www.usenix.org/legacy/events/hotos01/ —
    Practical identity and execution-attestation perspective relevant when
    binding bonded membership to a hardware-backed authenticator.
    [unverified] The user prompt mentioned "Garfinkel-Rosenblum on
    identity"; the authors are well known for HotOS work but I could not
    pinpoint a single canonical "on identity" paper via search. Verify and
    replace before publishing.

## 8. Secret sharing

23. **Shamir, A.** "How to Share a Secret." *Communications of the ACM*
    22(11): 612–613, November 1979.
    DOI: 10.1145/359168.359176. URL: https://dl.acm.org/doi/10.1145/359168.359176 —
    The (k, n) threshold-secret-sharing primitive at the core of
    social-recovery / federated-KMS rekey protocols.

## 9. Authenticators (WebAuthn / FIDO2)

24. **W3C.** "Web Authentication: An API for Accessing Public Key
    Credentials, Level 2." W3C Recommendation, 8 April 2021.
    URL: https://www.w3.org/TR/webauthn-2/ —
    The relying-party API surface our KMS uses for passkey device pairing.

25. **FIDO Alliance.** "Client to Authenticator Protocol (CTAP)" — FIDO2
    spec series.
    URL: https://fidoalliance.org/specs/fido-v2.0-id-20180227/fido-client-to-authenticator-protocol-v2.0-id-20180227.html —
    The authenticator-side protocol; combined with WebAuthn forms FIDO2.

## 10. Password hashing

26. **Biryukov, A.; Dinu, D.; Khovratovich, D.; Josefsson, S.** "Argon2
    Memory-Hard Function for Password Hashing and Proof-of-Work
    Applications." RFC 9106, IRTF / CFRG, September 2021.
    URL: https://www.rfc-editor.org/rfc/rfc9106.html —
    The KDF specification underlying passphrase-wrapped key material in the
    KMS.

---

## What we tried but could not fully verify

- WebFetch was denied in this environment; all entries above are stitched
  from WebSearch results, IETF/W3C canonical URLs (whose authority is
  high), and citation databases. URLs are real but were not retrieved.
- Garfinkel & Rosenblum "on identity" (entry 22): could not pin down a
  single canonical reference matching the user's description; flagged
  `[unverified]`.
- The Spence (1973) "Job Market Signaling" paper (used in defense-research
  doc) is not listed here because the user's seminal-paper list did not
  include it; it remains a recommended addition for the lemons subsection.
- `[unverified]` / DOI gaps are noted inline.

Entry count: 26 numbered seminal works across 10 topic areas.
