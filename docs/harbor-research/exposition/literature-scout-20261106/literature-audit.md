# Literature scout: source and claim audit

Research cutoff: **6 November 2026, America/Los_Angeles**. Access occurred on that local date, beginning at 03:51 UTC on 7 November. This is a bounded verification pass over the supplied scout, not an exhaustive literature review.

**The scout is useful as a lead list, but its “settled,” “gap confirmed,” and “first suite” verdicts are not established by its citations.** Every one of the 74 numbered references has a separate disposition in [source-verification.json](source-verification.json). That file distinguishes original-link failure, alternate primary evidence, bibliographic verification, selected full-text checks, and unverified claims. It also records exact visible search arguments and short result excerpts; it is not a reconstructed full transcript.

There are 27 citations left at metadata/abstract verification. A paper’s existence, its abstract, and an author’s novelty claim do not verify its theorem, numerical methodology, or the absence of earlier work. Several numbered entries are duplicate versions or alternative hosts of one work. D8 and D29 have no numbered citations at all; supplemental primary sources were therefore added separately. Unnumbered body and “must-cite” leads are now inventoried separately with exact occurrences and links to the numbered records; outstanding verification remains explicit.

## Corrections that change the research plan

- **D1:** Basin’s \(U\) is a universe of traces, not an action class. Its enforceability theorem has computability conditions. The forcible-events preprint is **2102.09338**, whereas the scout’s prose says 2102.09255.
- **D3:** the cited IETF document is an individual draft, not a standard. The cited version expired before this cutoff. Semantic order, token validation and implementable meet operations are different obligations.
- **D5:** reference 14 is **Mestel 2019**, not Alvim et al. 2012. The original miracle theorem was recovered separately.
- **D14:** reference 27 is a **2024 blockchain trilemma paper**, not Seuken–Parkes 2014.
- **D20:** fixed-program data complexity cannot be substituted for combined complexity; the proposed inclusion in a tractable temporal fragment needs an actual translation proof.
- **D25:** reference 42 is **Jungnickel, De Resmini and Vanstone 1996**; reference 43 is **Solé and Zaslavsky 1994**. Neither is the work attributed to it in the scout.
- **D15:** source 73 explicitly says Secure Boot was disabled. Its displayed May 2026 date also conflicts with its July-style arXiv identifier; that anomaly remains unresolved.
- **D26, D29, D30 and D28:** uniqueness, intersection of guarantee sets, abstract-screen coverage and a failed novelty search do not respectively establish consensus, secure composition, a field-wide gap or priority.

## Direction-by-direction findings

### D1 — delayed enforcement

Read [Basin et al., Theorem 3.8 and Corollary 4.5](https://people.inf.ethz.ch/basin/pubs/tissec-enforce2013.pdf) and [Lin et al., channel models and synthesis construction](https://arxiv.org/html/2103.11273). These are substantial neighbors. A lease-duration inequality alone does not identify which action can be prevented, whether stale commands remain executable, or whether a bad commit occurs before expiry. The scout also omits decidability and empty-trace conditions from Basin’s theorem.

Next target: give an explicit plant with observation queues, clock steps, expiry and commit fencing; prove its relation to concrete execution, then state a conditional controllability theorem. Retain both lossy-channel and delayed-commit counterexamples. A lease novelty claim remains unverified.

### D3 — attenuation

Read [Macaroons’ verification construction](https://www.ndss-symposium.org/wp-content/uploads/2017/09/04_3_1.pdf), [RFC 2693 §6.3](https://datatracker.ietf.org/doc/html/rfc2693), and [draft-00 §8.2](https://datatracker.ietf.org/doc/html/draft-niyikiza-oauth-attenuating-agent-tokens-00). SPKI intersects authorization and validity after issuer/delegation conditions; Macaroons authenticates accumulated caveats. The draft labels formal verification as work in progress.

A semantic descending-chain lemma is valid once the order and acceptance relation are defined; it does not establish a cryptographic correspondence. Expiry ordering needs an explicit convention. Fixed meet attenuation is deflationary, not an extensive closure operator under the usual authority order. Next target: prove the concrete validator-to-order correspondence, with accepted-chain witnesses, rejected middle-hop escalation, expiry and discharge cases.

### D5 — leakage quantity and release semantics

The [original Alvim et al. paper](https://homepages.dcc.ufmg.br/~msalvim/publications/2012-CSF.pdf) defines finite channels and proves Theorem 5.1’s capacity bound. Smith’s original QEST theorem numbering remains an access gap: the cited ResearchGate lead is insufficient to claim official primary verification. Reference 14 identifies a different paper.

The proposed adaptive ledger needs an observable-transcript model, including failures, timing, termination and job-count choices. A bounded output alphabet supplies a counting bound only for observations actually represented by that alphabet. The [2026 credential paper](https://arxiv.org/html/2606.04141) expressly treats its leakage estimator as a practical signal. Next target: establish the channel reduction and allowed release-function semantics before claiming adaptive budget soundness.

### D6 — canaries

[The 2026 primary paper, §4.3](https://arxiv.org/html/2606.04141), distinguishes one leaked credential from repeated detector trials. Its uniform-choice model yields \(k(1-\beta)/(m+k)\); an adaptive attacker can defeat the indistinguishability premise. This supports the scout’s warning about naive exponentiation, not a general placement theorem.

For a latent-variable expression \(1-\mathbb E[\beta(Z)^k]\), conditional independence must be an assumption. Finite exchangeability alone does not supply an unrestricted de Finetti representation. Group-testing localization additionally needs a specified incidence/observation model. Next target: separate one-leak selection, correlated multi-leak detection and noisy placement experiments; identify the conditions under which each formula is testable.

### D8 — digest value

The historical Blackwell full text was blocked. Read the definitions in [Karni’s primary research manuscript](https://www.econ2.jhu.edu/people/karni/blackwell%27stheorem3_20.pdf), plus §3 and Theorem 1 of [Brooks, Frankel and Kamenica](https://benjaminbrooks.net/downloads/bfk_comparisons.pdf). These distinguish comparison across all decision problems from task-specific value and address additional information.

Zero excess loss for one merge/inspect task is not automatically zero Le Cam deficiency. The covering result needs action constraints, inspection limits, state space and the direction of comparison. Next target: define a task-restricted risk quantity, prove its exact covering equivalence, then investigate a separately stated approximation relation. The Le Cam original and the claimed absence of earlier combinatorial formulations remain unchecked.

### D13 — bonded judges

[Qiu, Carroll and Allen, §3.3 Theorem 1](https://arxiv.org/html/2601.20299), assumes a shared prior. Its truthful profile is a Bayesian Nash equilibrium with maximum ex-ante payoff, not a strict coalition-proof result for bribable outcome judges. The 2025 information-evaluation paper also changes title between the scout’s v1 and current v4; those versions must be cited deliberately.

Next target: define coalition utility, outside bribes, audit errors, judge participation and enforceable transfers. Prove an incentive statement with explicit payoff bounds, then check every public punishment state in a repeated version. No paper inspected here establishes the scout’s proposed bonded ceremony, and this pass does not establish its novelty.

### D14 — lineage and Sybils

Read [Seuken–Parkes, Theorems 1–3 and tightness analysis](https://dash.harvard.edu/server/api/core/bitstreams/7312037d-8968-6bd4-e053-0100007fdf3b/content). Their assumptions and strong/weak attack notions are substantive; conserved reputation and a spawn tree are not an interchangeable formulation. The authors’ publication list identifies the 2014 result as superseding their 2011 paper.

Conserving scores need not conserve allocation or utility. For additive utility across identities, the no-split condition should be written directly: \(\sum_j u(r_j)\leq u(\sum_jr_j)\). The scout’s “not superadditive” wording should not be adopted. Next target: prove the payoff inequality for the actual allocation rule and each split, trade and recombination transition; test per-identity thresholds and rewards.

### D15 — engine identity

Read [Cai et al., threat model and verification analysis](https://arxiv.org/html/2504.04715v1) and [H100+TDX §7](https://arxiv.org/html/2607.19353v1). Output-distribution tests and hardware attestation answer different questions. Performance measurements do not themselves establish that advertised weights, a specific request and its output were bound by verified execution.

Source 73 restricts its claims to its tested configuration and reports disabled Secure Boot. The abstract-only checks of other GPU benchmarks and zkLLM do not validate a general cost table. Next target: specify weight commitments, measured code, vendor trust, freshness, request binding and output binding separately, then define audit power against a particular substitution family. Unnumbered 2026 attestation and ZK leads remain unverified.

### D20 — temporal conflict detection

Read [IJCAI 2019 syntax and Theorems 13/16](https://www.ijcai.org/proceedings/2019/0261.pdf), [IJCAI 2020 Theorems 2/6/8](https://www.ijcai.org/Proceedings/2020/0266.pdf), and the [integer-timeline results](https://proceedings.kr.org/2020/79/kr2020-0079-walega-et-al.pdf). Rational versus integer time, numerical encoding, allowed operators and fixed versus input programs change the bounds. Removing conjunction alone leaves a PSPACE-hard temporal core. The tractable results require further restrictions.

The scout’s proposed STP/Horn/temporal-fragment inclusion is an obligation, not an established consequence. [The 2025 repair paper](https://arxiv.org/pdf/2505.10394) additionally distinguishes pointwise and interval-based inclusion. Next target: specify one exact grounded interval fragment and prove its translation and complexity. Treat incremental performance as an algorithmic result requiring its own update model.

### D25 — graph codes and culpability

The publisher metadata exposes two citation mismatches. The [cycle-code record](https://researchconnect.suny.edu/en/publications/maximality-of-the-cycle-code-of-a-graph/) identifies edge coordinates. Read [Robinson’s Proposition 23](https://arxiv.org/html/1603.01446), which bounds distance to a consistent global section under pseudometric/Lipschitz assumptions, and [BFT Forensics’ definitions](https://arxiv.org/html/2010.06785). Neither converts a residual or edge-error correction radius into unique malicious-vertex identification.

The scout correctly flags that the represented code matters, but its proposed vertex parameter still needs an observation map and adversary model. Next target: prove that different admissible culprit sets produce distinguishable signed evidence, or give an indistinguishability pair. Original Hakimi–Bredeson proof access remains unresolved; signatures authenticate statements without automatically establishing external truth.

### D26 — accountability without consensus

[BFT Forensics, Definitions 3.1–3.2](https://arxiv.org/html/2010.06785), separates agreement, validity, termination and post-violation evidence. [Gong et al.](https://www.usenix.org/system/files/usenixsecurity25-gong-tiantian.pdf) likewise separates safety and liveness in its partially synchronous SMR setting. A system that always refuses can satisfy uniqueness without implementing consensus. The reduction needs progress, validity and an appropriate input interface; fault thresholds depend on the model.

Next target: state how conflicting signed statements become available, what connectivity and scheduling hold, and when revocation takes effect. Only then combine dissemination time with a bounded admission rate and initial in-flight work to derive damage. A partitioned network or unbounded operation rate defeats an unconditional window bound.

### D29 — assurance composition

Read [Abadi–Lamport §5.2.1, Eq. 5 and Proposition 11](https://lamport.azurewebsites.net/pubs/abadi-composing.pdf). Its composition argument tracks behaviors, realizability and disjoint component-agent sets; it explicitly requires hypotheses beyond intersecting labels. The original McCullough/McLean claims were not fully checked here, and no Common Criteria text was verified.

Intersecting guarantee sets is a set operation. Showing that a composed implementation satisfies their intersection is a different proposition. Next target: represent each mode with guarantees, assumptions and evidence scope; prove one compatible composition rule and demonstrate failure when environments, identities or trusted components differ. No universal meet law or five-mode ordering has been established.

### D30 — governance benchmark

Read [AgentDojo’s user/injection-task definitions and deterministic state checks](https://arxiv.org/html/2406.13352), and the introduction of the [official MAST proceedings paper](https://proceedings.neurips.cc/paper_files/paper/2025/file/b1041e52d3be19f0a9bc491657488e4a-Paper-Datasets_and_Benchmarks_Track.pdf). Most remaining benchmark citations were screened through official abstract metadata only. This is enough to identify candidate neighbors, not to certify every missing feature.

Replace “gap confirmed” and “first suite” with a proposed coverage target. Next target: publish a versioned matrix of executable tasks, security properties, actors, attacks, scoring oracles and evidence level; inspect full text and artifacts before marking a topic absent. Distinguish a paper’s initial task inventory from an extensible benchmark’s capabilities.

### D28 — duplicate work and integration

Read [Xu et al., §§4 and 7](https://arxiv.org/html/2607.04697v2). Temporal overlap is its co-activity proxy; three-way merge replay measures textual conflicts. The method and threats to validity do not measure semantic duplication, lost state or the causal benefit of a single integrator. The [second study’s author replication package](https://github.com/gems-uff/agentic-conflicts) was recovered, but its conference PDF timed out and final publication status remains unchecked.

Next target: define duplicate work independently of overlapping text and instrument task lineage, abandoned edits and integration costs. Compare coordination policies under controlled task difficulty and base drift. Failure to find an earlier duplication study is not evidence of priority.

## Remaining verification work

The record is complete as an **inventory with explicit dispositions**, not as primary verification of every scout assertion. In particular:

- Obtain the original Smith QEST 2011, Blackwell 1953 and Hakimi–Bredeson 1968 texts through legitimate open copies; preserve the current access gaps.
- Resolve source 73’s displayed date anomaly; verify exact versions before citing changing titles or author lists.
- Read the remaining abstract-only papers when their specific results enter an argument. The scout’s numerical tables and dataset claims are not all validated.
- Verify unnumbered bibliography entries separately, especially Le Cam, temporal-constraint tractability, gossip, fork consistency, composition standards and the additional 2026 attestation/ZK works.
- Treat every proposed theorem as a model-specific target. No absence or firstness claim was established in this pass.

No local Port Daddy runtime, paid API, purchase, publication, commit or push was used. Work was confined to the two assigned audit files in the verified linked worktree.

## Unnumbered lead accounting amendment

The entire 444-line scout now has one disposition per source line in `source_unit_coverage`. The `unnumbered_leads` array covers named works, identifiers, unresolved author/work families, named methods and relevant software or standards appearing before the bibliography. Repeated appearances share a lead record and retain every mapped line/unit; distinct works are not collapsed merely because they share authors. Missing titles remain missing.

There are **186 leads and 366 occurrences**. Of 202 prose, list and data-table units, 172 contain mapped external leads and 30 explicitly have no distinct named external lead. Headings, subsection labels, blanks, separators, table headers and the 74 bibliography entries also have individual dispositions. This is one-to-one source-paragraph accounting, not correctness verification.

**56 leads reuse existing scoped evidence; 130 remain open.** 54 lead records link to numbered citations and 132 have no matching numbered citation. The latter include supplemental sources, historical access gaps, unnamed work families, methods and software: these inventory counts are not counts of primary papers. Smith's original QEST text and historical Blackwell/Hakimi originals remain access gaps; a secondary lecture does not verify Shannon's original theorem.

The amendment adds no searches or primary-result verification. Abstract checks remain abstract checks. Mistaken numbered citations are explicit mismatches, including Lin 2014, Alvim 2012, Hakimi–Bredeson, the attributed Jungnickel–Vanstone 1999 work, Polygraph and the judge-manipulation original. KBF, API-TAIL, IMMACULATE and AgentProv each receive a separate open blog-only lead.

The **74 numbered records and 14 direction checks are unchanged as JSON objects**; canonical SHA-256 equality is recorded in the amendment. Follow-up should identify unresolved originals, then read exact results for the proposed claims. Product documentation and named mathematical methods need appropriately scoped checks.

The earlier two-document intake’s **999 routed units are routing/accounting units, not 999 primary sources or 999 primary-verified claims**. This scout amendment does not change that boundary. Complete source accounting, link verification, full-text checking and exhaustive prior-art coverage remain separate claims.
