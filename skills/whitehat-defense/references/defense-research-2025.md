# Defense Research (2023–2025)

Curated, verified-via-WebSearch defense bibliography paired 1-to-1 with the
attack catalog in `../redteam-review/references/attack-research-2025.md`.
Topics: formal verification of capability protocols, adversary-resilient
filter constructions, Sybil-resistance, mechanism-design defenses against
collusion, lemons-market signaling/screening, WebAuthn deployment defenses,
CT-log monitoring tooling, and account-recovery hardening.

Conventions: every entry below was located via WebSearch; URLs are real but
were not retrieved with WebFetch (denied here). Summaries paraphrase search
snippets. Items marked `[unverified]` flag the specific fact at issue.

---

## 1. Formal verification of capability / authorization protocols

### 1.1 Blanchet, "Modeling and Verifying Security Protocols with the Applied Pi Calculus and ProVerif" — F&T Privacy & Security, 2016
- URL: https://bblanche.gitlabpages.inria.fr/publications/BlanchetFnTPS16.pdf ;
  DOI 10.1561/3300000004
- Summary: Definitive monograph on ProVerif's foundations: applied pi calculus
  semantics, Horn-clause translation, secrecy and authentication properties
  for unbounded sessions.
- Why it matters: This is the textbook to ground a ProVerif model of your
  Ed25519 macaroon-style chain.

### 1.2 Meier, Schmidt, Cremers, Basin, "The TAMARIN Prover for the Symbolic Analysis of Security Protocols" — CAV 2013
- URL: https://link.springer.com/chapter/10.1007/978-3-642-39799-8_48
- Summary: Introduces Tamarin's multiset-rewriting calculus, equational
  reasoning, and unbounded-session verification with falsification support.
- Why it matters: Tamarin is the appropriate tool when you need stateful
  reasoning (revocation, replay windows) — strictly stronger than ProVerif for
  your use case.

### 1.3 Cremers, Horvat, Hoyland, Scott, van der Merwe, "A Comprehensive Symbolic Analysis of TLS 1.3" — ACM CCS 2017
- URL: https://acmccs.github.io/papers/p1773-cremersA.pdf
- Summary: Most comprehensive symbolic Tamarin model of TLS 1.3 (draft 21);
  found unexpected interactions between handshake modes that could weaken
  authentication guarantees.
- Why it matters: Reference for how to model a real-world layered protocol in
  Tamarin. Your capability-token + KMS pairing is similar in scope.

### 1.4 Cremers, Horvat, Scott, van der Merwe, "Automated Analysis and Verification of TLS 1.3: 0-RTT, Resumption and Delayed Authentication" — IEEE S&P 2016
- URL: https://ieeexplore.ieee.org/document/7546518/
- Summary: Earlier Tamarin model focused on 0-RTT replay, session resumption,
  and delayed authentication.
- Why it matters: Resumption modeling is the right pattern for analyzing your
  multi-hop attenuation chain across sessions.

### 1.5 "Formal Verification of Permission Voucher Protocol" — arXiv 2412.16224 (Dec 2024)
- URL: https://arxiv.org/abs/2412.16224
- Summary: Tamarin model of a delegation/voucher scheme; identifies the
  attenuation-vs-revocation soundness boundary.
- Why it matters: Closest 2024 formal-verification artifact for your design.
- [unverified] PDF not retrieved; details paraphrased from snippet.

### 1.6 "User-Guided Verification of Security Protocols via Sound Animation" — arXiv 2410.00676 (2024)
- URL: https://arxiv.org/abs/2410.00676
- Summary: Approach combining symbolic execution and animation to make
  protocol verification accessible to engineers, not just formal-methods
  specialists.
- Why it matters: Practical tooling angle for your team — verification you
  can actually run in CI.

---

## 2. Adversary-resilient Bloom / cuckoo filter design

### 2.1 Naor & Yogev, "Bloom Filters in Adversarial Environments" — CRYPTO 2015 / TALG 2019
- URLs: https://eprint.iacr.org/2015/543 ; https://dl.acm.org/doi/10.1145/3306193
- Summary: Tight characterization: adversarial-resilient Bloom filters ⇔ OWFs
  exist; gives a generic transformation using a PRF.
- Why it matters: The PRF-keyed-hash transformation is the minimum your
  cuckoo revocation filter should adopt to be adversary-resilient.

### 2.2 "Adversary Resilient Learned Bloom Filters" — IACR eprint 2024/754 (also Springer 2024)
- URL: https://eprint.iacr.org/2024/754.pdf ;
  https://link.springer.com/chapter/10.1007/978-981-95-5096-8_6
- Summary: Two constructions (PRP-LBF, Cuckoo-LBF) with formal security
  proofs against adaptive adversaries assuming OWFs.
- Why it matters: Most current (2024) construction directly applicable to a
  cuckoo revocation filter that needs adaptive-adversary resilience.

### 2.3 "On the Privacy of Adaptive Cuckoo Filters: Analysis and Protection" — 2024
- URL: https://www.researchgate.net/publication/380836698
- Summary: Defense ("preprocessing reduction") against the membership-leakage
  attack on adaptive cuckoo filters; trades a measured FPR cost for
  unlinkability.
- Why it matters: Direct mitigation if your gossip leaks adaptation events.

### 2.4 "Adversarially Robust Bloom Filters: Monotonicity and Betting" — IACR CIC 2024
- URL: https://cic.iacr.org/p/2/1/24
- Summary: Refines the Naor–Yogev framework with new lower bounds and a
  martingale-based proof technique; gives an "adversary advantage = bettor's
  advantage" characterization.
- Why it matters: Sharper bounds for sizing your filter against a quantified
  adversary.

### 2.5 Mitzenmacher et al. (Adaptive Cuckoo Filters, original) — ACM JEA 2019
- URL: https://dl.acm.org/doi/10.1145/3339504
- Summary: The adaptive cuckoo filter design that the 2022 attack later
  exploited; useful as the canonical baseline plus its trade-off discussion.
- Why it matters: Lets you compare the adaptive design against
  PRF-keyed-static and decide which point on the curve fits your adversary
  model.

---

## 3. Sybil resistance and reputation-system robustness

### 3.1 "Sybil in the Haystack: Comprehensive Review of Blockchain Consensus Mechanisms in Search of Strong Sybil Attack Resistance" — Algorithms 16(1), 2023
- URL: https://www.mdpi.com/1999-4893/16/1/34
- Summary: Surveys defense mechanisms; concludes that only PoW and PoS deliver
  strong Sybil-resistance permissionlessly; reputation/physical-linking
  approaches are weaker.
- Why it matters: Sets the theoretical ceiling for what your bonded-commons
  membership can claim.

### 3.2 Stannat & Pouwelse, "Achieving Sybil-Proofness in Distributed Work Systems" — AAMAS 2021
- URL: https://www.ifaamas.org/Proceedings/aamas2021/pdfs/p1263.pdf
- Summary: Impossibility result for reputation mechanisms satisfying three
  natural axioms; characterizes which axioms can be retained.
- Why it matters: Tells you which reputation-property to give up; the
  paper's "drop independence-of-disconnected-nodes" route fits a bonded
  commons.

### 3.3 "Privacy-Preserving Economic Dispatch for Multi-Energy Virtual Power Plants: A Distributed Approach Against Sybil Attacks" — Applied Energy, 2025
- URL: https://www.sciencedirect.com/science/article/abs/pii/S0306261925019749
- Summary: Reputation-based defense in a fully distributed multi-agent dispatch
  framework; demonstrates resilience to Sybil floods in cyber-physical setting.
- Why it matters: Recent applied-domain template for combining bonded
  participation + reputation + privacy.

### 3.4 "Sybil Attack Vulnerability Trilemma" — IJPEDS, 2024
- URL: https://www.tandfonline.com/doi/full/10.1080/17445760.2024.2352740
- Summary: Articulates a trilemma between openness, decentralization, and
  Sybil-resistance for permissionless systems.
- Why it matters: Frames the design space your bonded commons sits in;
  surfaces which corner you're choosing.

### 3.5 Vyzovitis et al., "GossipSub" (carry-over from attack list, defense lens)
- URL: https://research.protocol.ai/publications/gossipsub-attack-resilient-message-propagation-in-the-filecoin-and-eth2.0-networks/vyzovitis2020a.pdf
- Summary: Peer-scoring overlay mesh that combines pubsub fanout with
  per-peer reputation; resilient to sybil flooding and eclipse.
- Why it matters: Reference design for your gossip layer.

---

## 4. Mechanism-design defenses against cartels (Pigouvian fees, bond-on-entry)

### 4.1 "Pigouvian Algorithmic Platform Design" — JEBO, 2023
- URLs: https://ora.ox.ac.uk/objects/uuid:44f9e418-6a7f-4ca6-9ffc-c526e4721da3 ;
  https://www.sciencedirect.com/science/article/pii/S0167268123001725
- Summary: Derives a Pigouvian-tax scheme that pushes algorithmic-pricing
  agents back to competitive outcomes; tax restores socially optimal
  equilibrium even when reinforcement learners would otherwise tacitly
  collude.
- Why it matters: Concrete recipe for your fee schedule on the bonded
  commons. If insurers tacitly collude, a Pigouvian wedge restores
  competitiveness.

### 4.2 Csóka, Liu, Rodivilov, Teytelboym, "A Collusion-Proof Efficient Dynamic Mechanism" — SSRN 4419623, 2023
- URL: https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4419623
- Summary: Characterizes an efficient, budget-balanced, incentive-compatible
  mechanism robust to collusion in a general dynamic-types environment.
- Why it matters: Theoretical existence result for a mechanism close to what
  you want for transaction-underwriting.

### 4.3 Chung et al., "Collusion-Resilience in Transaction Fee Mechanism Design" — ACM EC 2024 (eprint 2024/237)
- URL: https://eprint.iacr.org/2024/237.pdf
- Summary: Formal impossibility for jointly achieving truthful + efficient +
  collusion-resilient TFMs without staking; gives staking-based protocols
  achieving the best feasible point.
- Why it matters: Direct support for your bond-on-entry design and a guide
  for sizing the bond.

### 4.4 "Regulatory Mechanism Design with Extortionary Collusion" — JET, 2023
- URL: https://www.sciencedirect.com/science/article/abs/pii/S0022053123000108
- Summary: Mechanism-design analysis when colluders can also extort; shows
  optimal regulator strategy combines fines + reporting incentives.
- Why it matters: Models the realistic case where one colluder threatens
  another to maintain the cartel — your Bonded Advisor has to anticipate it.

---

## 5. Lemons-market mitigation: screening / signaling

### 5.1 Spence, "Job Market Signaling" — QJE 1973 (foundational)
- URL: https://www.jstor.org/stable/1882010 (locator)
- Summary: Establishes the canonical signaling framework: costly signals
  separate types when low-types' marginal cost exceeds the wage premium.
- Why it matters: Bond size is your signal. Sizing it to a separating
  equilibrium is exactly Spence.

### 5.2 Lewis, "Asymmetric Information, Adverse Selection and Online Disclosure: The Case of eBay Motors" — AER 101(4), 2011
- URL: https://www.aeaweb.org/articles?id=10.1257/aer.101.4.1535
- Summary: Voluntary disclosure mitigates adverse selection in repeated online
  auctions; mandatory disclosure mitigates more.
- Why it matters: Empirical validation that publishing agent histories (with
  privacy) reduces adverse selection in your insurance pool.

### 5.3 Levin, "Information and the Market for Lemons" — RAND J. Economics, 2001
- URL: https://web.stanford.edu/~jdlevin/Papers/Lemons.pdf
- Summary: Conditions under which improving buyer information improves /
  worsens market efficiency; not always monotonic.
- Why it matters: Cautions against assuming "more transparency = better" —
  your reputation discount needs careful calibration.

### 5.4 Wilson, "A Model of Insurance Markets with Incomplete Information" — JET 16(2), 1977
- URL: https://ideas.repec.org/a/eee/jetheo/v16y1977i2p167-207.html
- Summary: Anticipatory-equilibrium concept addressing the Rothschild-Stiglitz
  non-existence problem; gives existence of pooling equilibria under
  forward-looking firms.
- Why it matters: When your competitive insurance market would otherwise have
  no equilibrium (R-S 1976), Wilson's anticipatory equilibrium gives you a
  defensible target.

---

## 6. WebAuthn deployment defenses

### 6.1 W3C Web Authentication: An API for Accessing Public Key Credentials, Level 2 — W3C Recommendation, 8 April 2021
- URL: https://www.w3.org/TR/webauthn-2/
- Summary: Normative API spec for public-key credentials. Level 2 adds
  Enterprise Attestation, cross-origin iFrame, large-blob storage,
  discoverable credentials.
- Why it matters: Your KMS device-pairing flow must conform; deviations are
  attack surface.

### 6.2 W3C WebAuthn Level 3 (in development)
- URL: https://www.w3.org/TR/webauthn-3/
- Summary: Adds clarifications and new features post-Level-2 (incl. PRF
  extension widely used by passkey password-managers).
- Why it matters: Track-changes view of where WebAuthn is heading; PRF
  extension is relevant if you derive KEK material from passkeys.

### 6.3 FIDO Alliance, "Recommended Account Recovery Practices for FIDO Relying Parties"
- URL: https://fidoalliance.org/recommended-account-recovery-practices/
- Summary: Authoritative recovery-design guidance: register multiple
  authenticators per account from the start; prefer device-bound
  cross-registration over email/SMS reset.
- Why it matters: Direct counter to magic-link-only recovery; your design
  should justify any deviation from these practices.

### 6.4 "Proactive FIDO Account Recovery using Managerless Group Encryption" — IACR eprint 2022/1555
- URL: https://eprint.iacr.org/2022/1555.pdf
- Summary: Cryptographic recovery scheme spreading recovery capability across
  a group without a designated manager; aims for "no email reset" recovery.
- Why it matters: Closer to a federated-KMS-friendly recovery primitive than
  email magic links.

### 6.5 "State of Passkey Authentication in the Wild: Census of Top 100K Sites"
- URL: https://arxiv.org/abs/2602.15135 (verify ID)
- Summary: Empirical census; finds ceremony enforcement and recovery
  inconsistencies across deployments.
- Why it matters: Use the empirical failure list as a deployment checklist.
- [unverified] arXiv ID format suspicious (2602 prefix).

---

## 7. CT log monitoring / consistency-proof tooling

### 7.1 Laurie, Langley, Kasper, "Certificate Transparency" — RFC 6962, June 2013
- URL: https://www.rfc-editor.org/rfc/rfc6962.html
- Summary: The CT protocol — append-only Merkle log, SCTs, audit/consistency
  proofs.
- Why it matters: The architectural pattern your evidence ledger is copying.

### 7.2 "Certificate Transparency Version 2.0" — RFC 9162 (cited by Laurie/Messeri search hit)
- URL: search-located via Semantic Scholar
- Summary: Updates CT to v2 with improvements to SCT extensions, log
  parameters, and signature schemes.
- Why it matters: If you're standing up a CT-style log today, target v2 not
  v1.

### 7.3 SSLMate Cert Spotter — open-source CT log monitor
- URLs: https://sslmate.com/certspotter/ ; https://github.com/SSLMate/certspotter
- Summary: Lightweight monitor that fetches all currently-trusted Chrome and
  Apple-listed logs, audits append-only behavior, and verifies consistency
  proofs (`VerifyConsistencyProof`).
- Why it matters: Reference implementation for the watcher role you need on
  your evidence ledger.

### 7.4 PRISM-based PhD thesis, "Quantitative Verification of Gossip Protocols for Certificate Transparency"
- URL: https://www.prismmodelchecker.org/papers/michael-oxford-phd-thesis.pdf
- Summary: Probabilistic model checking of CT gossip; quantitative bounds on
  split-view detection probability vs. gossip parameters.
- Why it matters: Use to size your evidence-ledger gossip mesh.

### 7.5 "CTng: Secure Certificate and Revocation Transparency" — IACR 2021/818
- URL: https://eprint.iacr.org/2021/818.pdf
- Summary: A redesigned CT that integrates revocation transparency and
  removes split-view attacks via mandatory gossip.
- Why it matters: A modern blueprint when CT alone leaves you with a
  split-view residue.

### 7.6 "Consistency-or-Die: Consistency for Key Transparency" — IACR 2024/879
- URL: https://eprint.iacr.org/2024/879.pdf
- Summary: Defines what a Key Transparency log must guarantee; argues active
  gossip is required, not optional.
- Why it matters: Strongest applicable defense statement for your KMS log.

### 7.7 NDSS 2024, "Certificate Transparency Revisited: The Public Inspections on Third-Party Monitors"
- URL: https://www.ndss-symposium.org/wp-content/uploads/2024-834-paper.pdf
- Summary: Watcher-of-watchers design that catches monitor misbehavior and
  re-detects split-view affecting domains.
- Why it matters: Defends the analytics layer of the evidence pipeline.

---

## 8. Account-recovery hardening (FIDO recovery codes, Shamir, social escrow)

### 8.1 Shamir, "How to Share a Secret" — CACM 22(11), 1979
- URL: https://dl.acm.org/doi/10.1145/359168.359176
- Summary: Threshold secret-sharing via Lagrange interpolation: any k of n
  shares reconstruct the secret; k-1 shares reveal nothing.
- Why it matters: The cryptographic primitive for "social escrow" recovery
  without trusted custodian.

### 8.2 "Smart Contract-Based Social Recovery Wallet Management Scheme for Digital Assets" — ACM SE 2023
- URL: https://dl.acm.org/doi/abs/10.1145/3564746.3587016
- Summary: Concrete social-recovery design with on-chain enforcement and
  partial-share custody.
- Why it matters: An applied template you can adapt for your KMS recovery
  ceremony.

### 8.3 "Traceable Bottom-Up Secret Sharing and Law and Order on Community Social Key Recovery" — Springer, 2024+
- URL: https://link.springer.com/chapter/10.1007/978-3-032-13301-4_18
- Summary: Adds traceability to social-recovery shares so collusion or
  share-leak is auditable post hoc.
- Why it matters: Closes a critical gap in vanilla Shamir social recovery —
  who leaked the share?

### 8.4 "New Bounds on the Local Leakage Resilience of Shamir's Secret Sharing Scheme" — IACR 2023/805
- URL: https://eprint.iacr.org/2023/805
- Summary: Tighter bounds on side-channel leakage resilience for Shamir
  shares at small thresholds.
- Why it matters: Quantifies how careful you have to be with share storage
  on user devices.

### 8.5 FIDO Alliance "Recommended Account Recovery Practices" (carry-over)
- URL: https://fidoalliance.org/recommended-account-recovery-practices/
- Summary: Canonical operational guidance: pre-register multiple
  authenticators; treat any non-FIDO recovery path as the weakest link.
- Why it matters: Direct counter to relying on email magic links as primary
  recovery.

---

## What we tried but could not fully verify

- WebFetch was denied; all summaries paraphrase WebSearch snippets only.
- Some arXiv IDs (e.g. 2602.15135 for the WebAuthn census) carry suspicious
  year prefixes; treat as `[unverified]` until checked at arxiv.org.
- Spence (1973) entry uses a JSTOR locator — not all readers will have
  access; consider citing a textbook treatment as backup.
- We could not verify the exact DOI for "CTng" (eprint 2021/818) beyond the
  IACR ePrint URL, which is canonical for ePrint papers but not always
  peer-reviewed.

Entry count: 33 numbered entries across 8 topic areas.
