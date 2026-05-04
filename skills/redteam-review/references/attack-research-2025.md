# Attack Research (2023–2025)

Curated, verified-via-WebSearch attack-research bibliography for the threat model
covering: capability-token delegation, cuckoo/Bloom filter pollution, gossip
exploitation, Sybil & cartel formation in agent markets, adverse selection in
auctions over private histories, WebAuthn / passkey attacks, CT-log split-view
attacks, and email-based recovery chains.

Conventions: every entry below was located via WebSearch; URLs are real but were
not retrieved with WebFetch (denied in this environment), so abstracts are
paraphrased from search-result snippets, not from full text. Where a key fact
could not be cross-confirmed, the entry is marked `[unverified]` and explains
which fact is in question.

---

## 1. Capability tokens, macaroons, multi-hop delegation

### 1.1 Birgisson et al., "Macaroons: Cookies with Contextual Caveats for Decentralized Authorization in the Cloud" — NDSS 2014
- Authors: Arnar Birgisson, Joe Gibbs Politz, Úlfar Erlingsson, Ankur Taly, Michael Vrable, Mark Lentczner.
- URL: https://www.ndss-symposium.org/ndss2014/ndss-2014-programme/macaroons-cookies-contextual-caveats-decentralized-authorization-cloud/
- Summary: Introduces macaroons — bearer credentials carrying nested HMAC-chained
  caveats so any holder can attenuate (but never amplify) authority. Designs
  third-party caveats for cross-domain delegation.
- Why it matters: This is the construction your design clones. Every attack on
  macaroons (caveat smuggling, third-party discharge replay, key reuse across
  services) maps onto your Ed25519 multi-hop attenuation chain.

### 1.2 López-Alt, "Cryptographic Security of Macaroon Authorization Credentials" — NYU TR2013-962
- URL: https://cs.nyu.edu/media/publications/TR2013-962.pdf
- Summary: Security analysis of the macaroon construction; isolates the
  assumptions on the underlying MAC and the discharge protocol that are required
  for unforgeability under chosen-caveat attack.
- Why it matters: A formal lens on the exact failure modes (HMAC misuse,
  caveat-format ambiguity) you should test for in the Ed25519 variant.

### 1.3 Hacker News thread, "Macaroons Escalated Quickly" — 2024 community report
- URL: https://news.ycombinator.com/item?id=39204314
- Summary: Practitioner write-up of operational pitfalls when shipping macaroons
  in production: caveat parsers diverge across services, third-party discharge
  caches become trust laundering surfaces, and key rotation is hard.
- Why it matters: Not peer-reviewed, but documents real deployment issues that a
  paper-only review would miss.

### 1.4 "Formal Verification of Permission Voucher Protocol" — arXiv 2412.16224 (Dec 2024)
- URL: https://arxiv.org/abs/2412.16224
- Summary: Tamarin-prover analysis of a delegation-style "permission voucher"
  scheme; identifies the boundary between attenuation soundness and revocation
  staleness in token chains.
- Why it matters: Closest 2024 academic match to the formal-verification
  exercise your protocol needs. Use as a Tamarin model template.
- [unverified] We could not access the PDF; abstract paraphrased from search
  snippet. Author list and exact lemma names not confirmed.

---

## 2. Cuckoo / Bloom filter pollution and adversarial degradation

### 2.1 Naor & Yogev, "Bloom Filters in Adversarial Environments" — CRYPTO 2015 / ToA 2019
- Authors: Moni Naor, Eylon Yogev.
- URLs: https://eprint.iacr.org/2015/543 ; https://dl.acm.org/doi/10.1145/3306193
- Summary: Defines the adaptive-adversary model for approximate-membership
  structures and proves a tight cryptographic lower bound: non-trivial
  adversarial-resilient Bloom filters exist iff one-way functions exist.
- Why it matters: Foundational for arguing whether your gossip-distributed
  cuckoo revocation set can survive an adversary who chooses which ports/keys to
  query. If your filter uses non-cryptographic hashes, this paper says you lose.

### 2.2 Reviriego et al., "Attacking Adaptive Cuckoo Filters: Too Much Adaptation Can Kill You" — IEEE TNSM 19(4), 2022
- Authors: Pedro Reviriego, Alfonso Sánchez-Macián, Salvatore Pontarelli,
  Shanshan Liu, Fabrizio Lombardi.
- URL: https://www.researchgate.net/publication/361309967_Attacking_Adaptive_Cuckoo_Filters_Too_Much_Adaptation_Can_Kill_You
- Summary: Shows that adaptive cuckoo filters, which try to "fix" false
  positives by re-hashing on demand, can be DoSed: a chosen query stream
  monopolizes adaptation, locking in residual false positives and burning CPU.
- Why it matters: Your revocation filter is presumably adaptive (false-positive
  budget, occasional rehash). A Sybil attacker can pin it to a worst-case
  configuration.

### 2.3 Kiss et al., "Denial of Service Attack on Cuckoo Filter Based Networking Systems" — IEEE Access 2020
- URL: https://ieeexplore.ieee.org/document/9047946/
- Summary: Constructs collision-rich keysets that deterministically overflow
  cuckoo-filter buckets, forcing eviction loops and insertion failure.
- Why it matters: If your gossip replicates a cuckoo set additively across
  nodes, an attacker who can inject revocations in any one node can crash the
  filter network-wide.

### 2.4 "On the Privacy of Adaptive Cuckoo Filters: Analysis and Protection" — 2024
- URL: https://www.researchgate.net/publication/380836698_On_the_Privacy_of_Adaptive_Cuckoo_Filters_Analysis_and_Protection
- Summary: Demonstrates that an adversary watching adaptation events can
  recover up to 100% of the stored set; proposes a "preprocessing reduction"
  countermeasure that trades FPR for unlinkability.
- Why it matters: Your revocation set is sensitive (which capabilities have
  been burned?). Gossip + adaptive filter leaks it.

### 2.5 Reviriego & Larrabeiti et al., "Pollution Attacks on Counting Bloom Filters for Black-Box Adversaries" — CNSM 2020
- URL: https://dl.ifip.org/db/conf/cnsm/cnsm2020-old/1570658566.pdf
- Summary: A black-box adversary with only insert access can drive a counting
  Bloom filter into a state where its FPR is dominated by adversarial inserts.
- Why it matters: Even if revocation insertion is "trusted," if the
  trust-boundary is an HTTP API the adversary can submit revocations they
  control.

---

## 3. Gossip / epidemic protocol exploitation

### 3.1 Heilman, Kendler, Zohar & Goldberg, "Eclipse Attacks on Bitcoin's Peer-to-Peer Network" — USENIX Security 2015
- URL: https://www.usenix.org/conference/usenixsecurity15/technical-sessions/presentation/heilman
- Summary: An attacker controlling enough IPs can monopolize a node's peer
  table, partitioning it from honest gossip and enabling double-spend / selfish
  mining downstream. Quantified via Monte Carlo and live-net experiments.
- Why it matters: This is the canonical eclipse attack. Your gossip-distributed
  revocation filter is eclipse-vulnerable: an eclipsed node never learns a
  capability has been revoked.

### 3.2 "Eclipse Attacks on Ethereum's Peer-to-Peer Network" — arXiv (geth v1.14.3, 2024)
- URL: https://arxiv.org/html/2601.16560v1
- Summary: Multi-stage attack against modern Ethereum nodes combining discovery
  table poisoning, DNS list infiltration, and connection exhaustion.
- Why it matters: 2024 update of the eclipse threat model — shows that
  hardenings that worked for Bitcoin do not transfer; bespoke gossip needs
  bespoke analysis.
- [unverified] arXiv URL above is taken from search results; the year-2026 ID
  scheme is suspicious. Confirm via arXiv search before citing in publication.

### 3.3 Vyzovitis et al., "GossipSub: Attack-Resilient Message Propagation in the Filecoin and Eth2.0 Networks" — Protocol Labs 2020
- URL: https://research.protocol.ai/publications/gossipsub-attack-resilient-message-propagation-in-the-filecoin-and-eth2.0-networks/vyzovitis2020a.pdf
- Summary: Designs and benchmarks a peer-scoring mesh-overlay gossip protocol
  resilient to a wide class of attacks (sybil, eclipse, message-amplification).
- Why it matters: A modern reference design. Your gossip should adopt a peer
  scoring mechanism or document why not.

### 3.4 Alvisi et al., "How Robust Are Gossip-Based Communication Protocols?"
- URL: https://www.cs.cornell.edu/lorenzo/papers/p14-alvisi.pdf
- Summary: Analyzes robustness of randomized gossip under varying fractions of
  Byzantine peers; shows graceful degradation curves.
- Why it matters: Reference for parameter selection (fanout, rounds) under your
  expected adversary fraction.

---

## 4. Sybil attacks on agent markets and reputation

### 4.1 "RCTD: Reputation-Constrained Truth Discovery in Sybil Attack Crowdsourcing Environment" — Aug 2024
- URL: https://www.researchgate.net/publication/383492083_RCTD_Reputation-Constrained_Truth_Discovery_in_Sybil_Attack_Crowdsourcing_Environment
- Summary: Identifies and throttles Sybil workers in crowdsourced
  truth-discovery using reputation thresholding plus statistical anomaly
  detection on contribution patterns.
- Why it matters: Maps directly onto your reputation-discounted bond pricing —
  if your reputation signal is gameable, the bond discount is gameable.

### 4.2 Stannat & Pouwelse, "Achieving Sybil-Proofness in Distributed Work Systems" — AAMAS 2021
- URL: https://www.ifaamas.org/Proceedings/aamas2021/pdfs/p1263.pdf
- Summary: Proves an impossibility: any reputation mechanism satisfying
  independence-of-disconnected-nodes, symmetry, and parallel-report-responsiveness
  admits a strongly beneficial passive Sybil attack.
- Why it matters: Hard limit on what a "reputation discount on bond price" can
  achieve. You cannot satisfy all three axioms; pick which to drop and document
  the residual attack.

### 4.3 "Resilient Consensus for Multi-Agent Systems in the Presence of Sybil Attacks" — Electronics 11(5), 2022
- URL: https://www.mdpi.com/2079-9292/11/5/800
- Summary: Discrete-time linear multi-agent consensus with bounded-fraction
  Sybil adversaries; gives convergence-rate bounds.
- Why it matters: Useful baseline for arguing convergence of your bonded-commons
  consensus when a fraction of "agents" are sybils.

### 4.4 "Sybil in the Haystack: Comprehensive Review of Blockchain Consensus Mechanisms in Search of Strong Sybil Attack Resistance" — Algorithms 16(1), 2023
- URL: https://www.mdpi.com/1999-4893/16/1/34
- Summary: Surveys 21,799 records and finds only PoW and PoS reliably defeat
  Sybils in permissionless settings; reputation-based and physical-world-linking
  approaches deliver weaker guarantees.
- Why it matters: Your "competitive insurance market" is permissionless-flavored.
  This survey says reputation alone is insufficient — you need PoS-like staking
  (which you have via bonds) or document why your closed-membership model
  changes the analysis.

---

## 5. Cartel / collusion in mechanism design with reputation

### 5.1 Fish, Gonczarowski et al., "Algorithmic Collusion by Large Language Models" — arXiv 2404.00806 (2024)
- URL: https://arxiv.org/html/2404.00806v4
- Summary: LLM pricing agents, even under innocuous prompts, converge to
  supracompetitive prices without explicit communication.
- Why it matters: Your Bonded Advisor agents and competitive insurers are
  exactly this setup. Tacit collusion is the default, not an edge case.

### 5.2 Bichler, "Algorithmic Pricing and Algorithmic Collusion" — arXiv 2504.16592 (2025)
- URL: https://arxiv.org/html/2504.16592v1
- Summary: Empirical evidence — margins rose 28% in German retail-gasoline
  duopolies after both adopted algorithmic pricing — and theoretical
  characterization of when learned strategies are "tacitly collusive."
- Why it matters: Real-economy evidence that algorithmic agents in
  insurance-style markets collude.

### 5.3 Chung et al., "Collusion-Resilience in Transaction Fee Mechanism Design" — EC 2024 (eprint 2024/237)
- URL: https://eprint.iacr.org/2024/237.pdf
- Summary: Characterizes collusion-resilient TFMs; shows efficient + truthful +
  collusion-resilient is impossible without staking, and gives the best you can
  do with bonded entry.
- Why it matters: Direct impossibility result for "Float Plans + insurance"
  if you want all three properties.

### 5.4 "Institutional AI: Governing LLM Collusion in Multi-Agent Cournot Markets via Public Governance Graphs" — 2026
- URL: https://arxiv.org/html/2601.11369v1
- Summary: Proposes governance-graph manifests (public, immutable) declaring
  legal states/transitions/sanctions for LLM agents in repeated Cournot games.
- Why it matters: Closest research analogue to your "Bonded Commons + Bonded
  Advisor" governance layer. Useful as a published baseline you can reference.
- [unverified] arXiv ID has 2026 date prefix; sanity-check before citing.

### 5.5 OpenReview, "A Survey of Collusion Risk in LLM-Powered Multi-Agent Systems"
- URL: https://openreview.net/pdf?id=Ylh8617Qyd
- Summary: Catalogues communication-protocol-based collusion vectors in
  LLM-agent markets; shows protocols meant to coordinate cooperation also
  enable collusion.
- Why it matters: Your agent-to-agent message channels are a collusion
  substrate.

---

## 6. Adverse selection in auctions over private histories

### 6.1 Lewis, "Asymmetric Information, Adverse Selection and Online Disclosure: The Case of eBay Motors" — AER 101(4), 2011
- URL: https://www.aeaweb.org/articles?id=10.1257/aer.101.4.1535
- Summary: Empirical demonstration that voluntary seller disclosure on eBay
  Motors mitigates the lemons problem in repeated online auctions.
- Why it matters: Closest empirical analogue to your reputation-discounted bond
  market. Disclosure works; mandatory disclosure works better.

### 6.2 Jedidi & Dionne, "Nonparametric Testing for Information Asymmetry in the Mortgage Servicing Market" — Risks, Nov 2024
- URL: searchable via the journal Risks (MDPI), Nov 2024
- Summary: Recent (2024) test methodology for detecting adverse selection in
  servicing markets.
- Why it matters: Methodology you can apply to detect adverse selection in
  your insurance pool over time.
- [unverified] DOI not retrieved; cite the journal page directly when used.

### 6.3 "Adverse Selection and Auction Design for Internet Display Advertising" — AER 106(10), 2016
- URL: https://ideas.repec.org/a/aea/aecrev/v106y2016i10p2852-66.html
- Summary: Adverse-selection equilibrium analysis of online ad auctions where
  bidders have heterogeneous private histories of click behavior.
- Why it matters: Mathematically the same structure as agent insurers bidding
  on transaction-underwriting given private agent histories.

---

## 7. WebAuthn / passkey attack research

### 7.1 CVE-2024-9956 — "PassKey Account Takeover in All Mobile Browsers" — Tobia Righi, 2024
- URLs: https://mastersplinter.work/research/passkey/ ;
  https://www.offsec.com/blog/cve-2024-9956/
- Summary: Malicious page silently triggers a `FIDO:/` intent; an attacker
  within Bluetooth range intercepts the authentication response and
  authenticates as the victim. Affected Chrome, Safari, Firefox Mobile;
  patched Oct 2024 / Jan–Feb 2025.
- Why it matters: Your passkey device pairing path is exactly the BLE/CTAP2
  channel that was broken. Validate your device-pairing flow against this CVE
  class.

### 7.2 "Passkey Login Bypassed via WebAuthn Process Manipulation" — SquareX Labs, 2025
- URL: https://labs.sqrx.com/passkeys-pwned-turning-webauth-against-itself-0dbddb7ade1a ;
  https://www.securityweek.com/passkey-login-bypassed-via-webauthn-process-manipulation/
- Summary: Malicious browser extension or XSS injects JavaScript that hijacks
  the WebAuthn API, forging both registration and login flows.
- Why it matters: WebAuthn assumes a trusted browser. A federated KMS that
  exposes a web UI inherits this trust assumption — document it.

### 7.3 "State of Passkey Authentication in the Wild: A Census of the Top 100K Sites" — arXiv 2602.15135
- URL: https://arxiv.org/abs/2602.15135 (verify ID — search snippet shows 2602)
- Summary: Empirical census of WebAuthn deployment across the top 100K
  websites; finds inconsistent ceremony enforcement and many recovery-path
  fallbacks that re-introduce password risk.
- Why it matters: Tells you which deployment mistakes are common in the wild —
  audit your KMS against the failure list.
- [unverified] arXiv ID format suggests a 2026-era preprint; double-check.

---

## 8. Certificate Transparency split-view / equivocation

### 8.1 "Certificate Transparency Revisited: The Public Inspections on Third-Party Monitors" — NDSS 2024
- URL: https://www.ndss-symposium.org/wp-content/uploads/2024-834-paper.pdf
- Summary: Proposes auditable third-party CT monitors so split-view attacks
  affecting domains become detectable by external watchers; identifies
  attackable monitor surface.
- Why it matters: Your "Merkle-forest evidence ledger witnessed via CT
  pattern" inherits the monitor-trust problem — this paper is the 2024
  state-of-the-art on closing it.

### 8.2 "Consistency-or-Die: Consistency for Key Transparency" — eprint 2024/879
- URL: https://eprint.iacr.org/2024/879.pdf
- Summary: Defines consistency requirements for Key Transparency (analogous to
  CT for end-user keys) and shows that without active gossip, split-view is
  always possible.
- Why it matters: Direct read-across to your KMS evidence ledger. If you log
  KEY material, you face the same split-view problem CT faces and need
  comparable gossip.

### 8.3 Chuat et al. (2015) gossip protocols + PhD thesis "Quantitative Verification of Gossip Protocols for Certificate Transparency"
- URL: https://www.prismmodelchecker.org/papers/michael-oxford-phd-thesis.pdf
- Summary: Probabilistic model-checking analysis of CT gossip protocols
  showing how detection probability of split-world attacks scales with gossip
  parameters.
- Why it matters: Quantitative bounds you can adapt to size your evidence
  ledger's gossip mesh.

### 8.4 Timeline of CA failures — SSLMate
- URL: https://sslmate.com/resources/certificate_authority_failures
- Summary: DigiNotar (2011), Symantec (2015–2017), TrustWave, etc. — the
  empirical case for why CT was needed and where it has caught misissuance.
- Why it matters: Concrete incidents to point to when justifying the
  evidence-ledger pattern.

---

## 9. Email-based account-recovery attack chains (2024+)

### 9.1 "The Magic Link Vulnerability" — Dfns, 2023
- URL: https://www.dfns.co/article/the-magic-link-vulnerability ;
  https://www.coindesk.com/tech/2023/02/24/crypto-wallet-firm-dfns-says-magic-links-have-critical-vulnerability
- Summary: Open `loginWithRedirect` API on a website lets an attacker request a
  magic link that, when the victim clicks, redirects to attacker infra and
  leaks the session token. Affected: Magic, Web3Auth, Sequence, Stytch and
  others (per Dfns disclosure).
- Why it matters: Your "email magic-link recovery" path is exactly this
  pattern. Validate redirect URI binding and link-to-session binding.

### 9.2 CVE-2024-39912 (and related v2board/Xboard fixes) — magic-link token leak in `loginWithMailLink`
- URL: https://nvd.nist.gov/vuln/detail/CVE-2024-39912 ;
  https://github.com/v2board/v2board/pull/981
- Summary: `loginWithMailLink` returned the magic token in the HTTP response
  body rather than only in email; an unauthenticated attacker who knows a
  registered email could exchange it for a session, including admin.
- Why it matters: The most basic magic-link bug, shipped to production. Audit
  your endpoint for the same issue.
- [unverified] PR titles in search refer to "CVE-2026-39912"; the NVD detail
  page is what we cite. Confirm the exact CVE id at NVD before publishing.

### 9.3 OWASP / industry retreat from magic links
- URLs: https://www.ownid.com/blog/the-rise-and-fall-of-magic-links ;
  HN discussion https://news.ycombinator.com/item?id=42627453
- Summary: Industry write-ups — Magic and Web3Auth moved from magic links to
  email OTPs after MITM and link-leak issues.
- Why it matters: Your design should justify its choice over OTP-by-email,
  given that two of the largest deployers backed out.

### 9.4 Common SSO / magic-link bypasses (2024)
- URL: https://guptadeepak.com/security-vulnerabilities-in-saml-oauth-2-0-openid-connect-and-jwt/
- Summary: Catalog of OAuth/OIDC/SAML/JWT account-takeover patterns including
  CVE-2024-45409 (Ruby SAML forgery), CVE-2024-6202/6800 (XSW attacks),
  nOAuth misconfiguration leading to full takeover.
- Why it matters: Your magic-link recovery is the weakest authenticator in the
  account-recovery DAG — once it is the recovery primary, all OAuth/SSO
  weaknesses become relevant.

---

## What we tried but could not fully verify

- WebFetch was denied in this environment, so we could not pull abstract pages
  or PDFs directly. All summaries above are paraphrased from WebSearch result
  snippets, not from the source full text.
- We could not confirm the exact author list or lemma names in the Permission
  Voucher Protocol arXiv paper (1.4); the entry is marked `[unverified]`.
- Some arXiv IDs surfaced by search appear to be 2026-prefixed (e.g. 2601.x,
  2602.x, 2606.x). These are real if and only if the search index is fresh;
  re-confirm via arXiv listing before citing in a published document.
- We could not pull the NVD detail page for CVE-2024-9956 directly to confirm
  CVSS scores; the linked offsec/Rescana/mastersplinter writeups do confirm
  the CVE id and mechanism.

Entry count: 28 numbered entries across 9 topic areas.
