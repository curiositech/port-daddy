# Anchor Protocol Workstream Backlog

Last updated: 2026-04-11
Authoring session: `agent-6ac301bd` / `port-daddy:anchor-protocol`
Status: Draft execution backlog for Batch 1 feedback capture

## Purpose

This document captures the first large batch of Anchor Protocol feedback as durable repo truth.
It exists to prevent the current context from evaporating into chat and to stop future agents from reducing this workstream to "website polish" or "copy cleanup."

The backlog below is intentionally granular. Each task includes:

- objective
- why it matters
- expected deliverables
- likely files/surfaces
- dependencies
- acceptance criteria
- open risks or contradictions

## Completed Prerequisite Slices

- [x] Repository truth contracts for the anchor-adjacent claims that kept drifting.
  - How: `tests/unit/repo-authority-contracts.test.js` now mechanically guards `graph_edges` existence in code, active Phase 2 Ed25519 harbor issuance, and explicit legacy-only HS256 verification.
- [x] Repo-doc drift cleanup for graph and harbor protocol truth.
  - How: `docs/V4-UNIFIED-ROADMAP.md`, `docs/SECURITY_SOUNDNESS.md`, and `docs/reports/PORT_DADDY_ANCHOR_WHITEPAPER.md` were corrected so they no longer describe `graph_edges` as missing, no longer say active harbor issuance is still Phase 1 HS256, and no longer present Phase 3 delegation as already-live runtime truth.
- [x] Ideation-control surface for future Anchor/economy work so the same feedback does not keep reappearing as new markdown noise.
  - How: `docs/recovery/IDEAS-TROVE.md` is now the canonical ideation index, `pd ideas list/search/show` can query it directly, `pd ideas search` now federates optional local `.spark/.spider` residue plus live daemon notes/tuples and repo markdown, and Spark/Spider prompts now have a narrow `Bash(pd ideas*)` path so they can dedupe against the same surface.

## Core Distinctions

Future agents must preserve these distinctions unless the product direction is explicitly changed:

1. **Anchor Protocol** is the trust, identity, attenuation, and enforcement substrate.
2. **Agent economy** is the settlement, escrow, credits, and dispute layer built on top of that substrate.
3. **Monetization** is the packaging and go-to-market layer for hosted orchestration, relay, compliance, and trust operations.
4. **Verified protocol behavior** is not identical to **runtime enforcement reality**.
5. **Local operator value** is the adoption wedge. Cross-machine economy claims are downstream of local truth and graph activation.

## High-Signal Findings To Preserve

### User feedback captured

- The whitepaper should explicitly address the semantic gap between logical agent identity and OS process identity.
- The limitations section should foreground PID/process binding and "Ghost in the Harbor" realities more honestly.
- If TLA+ informs Arbiter invariants, the verification stack should mention it alongside ProVerif and Kani.
- The ProVerif subset axiom should be explicitly tied to the Rust/Kani proof of concrete subset logic.
- Any Kani unwind bound should be justified mathematically or softened.
- The introduction should frame the daemon as a control plane separate from the execution/data plane.
- The protocol is deliberately "boring" at the primitive level; the novelty is applying cloud-grade trust/accountability to localhost agent swarms.
- Extensions like distributed orchestration and zero-trust CI/CD are more strategically relevant than generic IoT positioning.
- Daemon-side hardening must be treated as a real roadmap topic: OS-level enforcement, key custody, revocation, and local transport.
- The website should feel like industrial operator infrastructure, not generic SaaS security theater.
- `agentsd.ai` is the candidate external brand for "infrastructure for the agentic economy"; maritime branding can remain in-product.
- Open-core monetization is the strongest packaging direction: core free, orchestration/compliance/relay paid.

### Spider-style dependency map

- The economy story is blocked more by the missing middle layer (`graph_edges` / semantic graph activation / honest public roadmap translation) than by copy quality.
- Website truth is carrying protocol-version claims, verification claims, and monetization-readiness claims. It is not "just presentation."
- There are already contradictions between internal roadmap truth and public website truth.
- The recovery queue is productizing operator UX faster than the older public roadmap reflects.
- Branding decisions are entangled with truthfulness. Tone and claim scope need explicit choice.

## Known Contradictions

These are not optional polish items. They are product-truth mismatches.

1. `website-v2/src/data/product.ts` reportedly still describes harbors as HMAC-signed capability tokens while the newer protocol narrative centers Ed25519 and delegation.
2. `website-v2/src/pages/RoadmapPage.tsx` reportedly reflects an older phase model that no longer matches `docs/V4-UNIFIED-ROADMAP.md`.
3. Public whitepaper metadata and repo docs disagree on page count for the Anchor paper.
4. Site messaging tends to blur "verified protocol" and "runtime enforcement."
5. Monetization is conceptually central in roadmap language while publicly deferred or fragmented in site architecture.
6. Branding/tone is split between practical local painkiller and grand formal protocol/economy narrative.

## Task Clusters

### Cluster A: Protocol Truth

#### AP-001: Rewrite the Anchor whitepaper limitations section around the semantic gap

- Objective:
  Replace the current limitations framing with a precise explanation that the formal models reason about logical identities while real swarms run as ephemeral OS processes.
- Why it matters:
  This is the cleanest way to make the paper more honest without weakening the protocol thesis.
- Deliverables:
  - revised limitation text using the "semantic gap" framing
  - explicit mention that Arbiter/runtime enforcement currently bridges this gap heuristically or operationally
- Likely files:
  - `docs/reports/PORT_DADDY_ANCHOR_WHITEPAPER.md`
  - `website-v2/public/whitepaper/anchor-protocol-whitepaper.tex`
- Dependencies:
  - confirm whether the `.tex` source of record lives under `website-v2/public/whitepaper/`
- Acceptance criteria:
  - the paper no longer implies that cryptographic identity automatically binds to a process/PID
  - "Ghost in the Harbor" is clearly described as an OS/runtime boundary issue
- Risks / open questions:
  - do not over-claim current Arbiter enforcement if it is still polling-based

#### AP-002: Expand the verification-stack explanation

- Objective:
  Present the verification story as a layered stack: ProVerif for symbolic protocol analysis, Kani for implementation checks, and TLA+-derived invariants if applicable.
- Why it matters:
  The current story risks sounding incomplete or aura-driven.
- Deliverables:
  - one short paragraph in the verification section
  - one short paragraph or sentence in the Arbiter section if TLA+ is genuinely part of the lineage
- Likely files:
  - `docs/reports/PORT_DADDY_ANCHOR_WHITEPAPER.md`
  - Anchor paper source in website public assets
- Dependencies:
  - verify whether TLA+ artifacts actually exist and are relied upon
- Acceptance criteria:
  - readers can tell which tool proves what
  - TLA+ is mentioned only if there is real backing
- Risks / open questions:
  - avoid introducing a new verification claim that the repo cannot support

#### AP-003: Close the ProVerif-to-Kani proof gap explicitly

- Objective:
  Add a sentence that the subset relation is abstracted in ProVerif and computationally grounded in the Rust implementation checks.
- Why it matters:
  This closes the most obvious formal-methods objection.
- Deliverables:
  - one explicit bridging sentence near the ProVerif subset logic discussion
- Likely files:
  - whitepaper markdown and source `.tex`
- Dependencies:
  - locate the concrete Rust subset-check implementation and confirm Kani coverage exists
- Acceptance criteria:
  - a skeptical reader can see how symbolic proof and concrete implementation proof relate

#### AP-004: Align phase numbering, algorithm numbering, and protocol evolution language

- Objective:
  Reduce cognitive load by reconciling "Phase 1/2/3" language with algorithm numbering and section naming.
- Why it matters:
  The paper should read as a system, not as layered archaeology.
- Deliverables:
  - renumbered algorithms or renamed sections
  - consistent terminology for HS256 pinning, Ed25519 identity, and delegation chains
- Likely files:
  - whitepaper source
  - supporting docs that restate the phases
- Acceptance criteria:
  - no reader needs to cross-map phases and algorithms manually

#### AP-005: Add a control-plane architecture paragraph to the introduction

- Objective:
  Reframe the paper as systems architecture, not just protocol exposition.
- Why it matters:
  This better matches the actual product direction.
- Deliverables:
  - intro paragraph explaining daemon as control plane, agents as execution/data plane
- Likely files:
  - whitepaper markdown and source `.tex`
- Acceptance criteria:
  - the paper reads like infrastructure architecture from section 1 onward

### Cluster B: Daemon Hardening Roadmap

#### AP-006: Create a daemon-hardening sub-roadmap for OS/process binding

- Objective:
  Capture the concrete system-level work needed to make the runtime boundary as serious as the protocol paper.
- Why it matters:
  Otherwise the repo will keep discussing strong guarantees without operational counterparts.
- Deliverables:
  - roadmap subsection or ADR appendix covering:
    - PID/process identity binding
    - socket ownership and process binding
    - race windows around crashed agents reclaiming ports
    - Linux-first vs macOS parity posture
- Likely files:
  - `docs/V4-UNIFIED-ROADMAP.md`
  - `docs/adr/0014-the-anchor-protocol.md`
  - possibly a new ADR
- Dependencies:
  - current Arbiter and anti-squatting implementation details
- Acceptance criteria:
  - the roadmap distinguishes reactive polling, stronger OS hooks, and future kernel-level enforcement

#### AP-007: Define root-key custody modes

- Objective:
  Separate baseline daemon key handling from future HSM/TPM/Secure Enclave modes.
- Why it matters:
  Key custody is a major trust boundary and a monetization surface.
- Deliverables:
  - explicit mode table:
    - local software key
    - secure enclave / TPM
    - cloud KMS / HSM
  - threat and packaging implications for each mode
- Likely files:
  - roadmap
  - whitepaper limitations or future work
  - website pricing/product copy later
- Acceptance criteria:
  - future agents do not treat hardware-backed root of trust as either mandatory today or irrelevant tomorrow

#### AP-008: Specify revocation architecture honestly

- Objective:
  Define what "instant revocation" means in local daemon mode and in future distributed mode.
- Why it matters:
  Token expiration alone is not enough once compromise is in play.
- Deliverables:
  - design note or ADR section comparing:
    - in-memory revoked-`jti` set
    - persisted revocation log
    - probabilistic structures only if scale actually demands them
- Likely files:
  - ADR 0014 or a new revocation ADR
- Dependencies:
  - actual protocol token fields and daemon enforcement path
- Acceptance criteria:
  - there is a first implementation path that is simple and debuggable
  - no premature Bloom-filter cargo culting

#### AP-009: Clarify local transport defaults vs remote transport strategy

- Objective:
  State clearly that local control should prefer permissioned IPC/UDS while networked harbor-to-harbor traffic is a different transport problem.
- Why it matters:
  Current rhetoric can accidentally imply one transport rule fits both local and distributed cases.
- Deliverables:
  - local vs remote transport section in roadmap or security docs
- Likely files:
  - whitepaper
  - roadmap
  - website security/product copy
- Acceptance criteria:
  - local bearer-token interception risk is addressed honestly
  - future distributed work is not blocked by a locally absolutist transport claim

### Cluster C: Economy And Monetization

#### AP-010: Separate protocol, economy, and monetization in the roadmap

- Objective:
  Refactor roadmap language so these three layers stop bleeding together.
- Why it matters:
  This is the single biggest conceptual cleanup in the whole workstream.
- Deliverables:
  - explicit section boundaries in `docs/V4-UNIFIED-ROADMAP.md`
  - summary language future agents can quote safely
- Likely files:
  - `docs/V4-UNIFIED-ROADMAP.md`
  - `docs/adr/0014-the-anchor-protocol.md`
- Acceptance criteria:
  - Anchor can be discussed without implying credits
  - credits can be discussed without implying paid SaaS
  - pricing can be discussed without pretending the economy is fully shipped

#### AP-011: Build an honest readiness model for the economy

- Objective:
  Tie economy readiness to graph activation, observability, trust-boundary mode, and settlement primitives.
- Why it matters:
  The repo already hints that pricing and bonds belong at trust boundaries, not default dev mode.
- Deliverables:
  - readiness ladder:
    - local authority-driven dev mode
    - evidence-backed work agreements
    - trust-boundary settlement
    - distributed relay / market mode
- Likely files:
  - roadmap
  - economist brief
  - vision docs
- Dependencies:
  - semantic graph workstream status
- Acceptance criteria:
  - public and internal narratives stop implying the same economic maturity level

#### AP-012: Redesign packaging around open core + hosted trust operations

- Objective:
  Convert the user’s monetization suggestions into a sharper packaging model.
- Why it matters:
  Current tiers are workable but still fuzzy.
- Deliverables:
  - proposed packaging matrix covering:
    - Community / OSS
    - Pro
    - Team or Enterprise
  - monetization metrics recommendation
- Likely files:
  - roadmap
  - future pricing page inputs
- Acceptance criteria:
  - pricing metric is not "per active agent session" by default
  - hosted value centers on visibility, policy, relay, and compliance before speculative market mechanics

#### AP-013: De-risk economy language in ADR 0014

- Objective:
  Revisit `docs/adr/0014-the-anchor-protocol.md` so it does not over-collapse verifiable economy, escrow, credits, and protocol substrate into one blob.
- Why it matters:
  ADR 0014 is currently one of the strongest sources of conceptual bleed.
- Deliverables:
  - edited ADR language or follow-on ADR clarifying layering
- Likely files:
  - `docs/adr/0014-the-anchor-protocol.md`
- Acceptance criteria:
  - work agreements, evidence, escrow, receipts, and credit economy are layered explicitly

### Cluster D: Brand And Narrative

#### AP-014: Decide the external narrative center of gravity

- Objective:
  Choose whether the public face leads with:
  - practical local coordination software
  - formal trust/control plane
  - infrastructure for the agentic economy
- Why it matters:
  The current repo carries all three narratives simultaneously.
- Deliverables:
  - one documented narrative choice with a secondary-message hierarchy
- Likely files:
  - website content docs
  - roadmap preface
  - branding notes
- Acceptance criteria:
  - hero copy, architecture copy, and pricing copy all point in the same direction

#### AP-015: Evaluate `agentsd.ai` as the external brand

- Objective:
  Make a deliberate brand decision instead of drifting between `port-daddy` and `agentsd`.
- Why it matters:
  Name choice changes the trust envelope, buyer expectations, and visual system.
- Deliverables:
  - short brand decision memo covering:
    - seriousness / gravity
    - memorability
    - genericness risk
    - relationship to in-product maritime language
- Likely files:
  - new branding memo under `docs/plans/` or `website-v2` docs
- Acceptance criteria:
  - future agents know whether `agentsd.ai` is exploratory or official

#### AP-016: Create a claims taxonomy for site language

- Objective:
  Divide site claims into:
  - true now
  - true in repo but rough
  - planned / future
  - prohibited overclaims
- Why it matters:
  This is the best defense against future website drift.
- Deliverables:
  - claim registry table
  - examples of acceptable vs unacceptable phrasing
- Likely files:
  - new doc under `docs/plans/`
  - later consumed by `website-v2`
- Acceptance criteria:
  - no future site change can casually blur "verified protocol" and "runtime enforcement"

### Cluster E: Website And Rebrand Execution

#### AP-017: Preserve the visual system from the `agentsd` mock, not its inflated claims

- Objective:
  Extract the mock’s strongest transferable design patterns without inheriting speculative messaging.
- Why it matters:
  The mock’s strength is its operator-software visual grammar.
- Deliverables:
  - design carry-forward memo covering:
    - visible grid
    - hard borders
    - sparse accent palette
    - mono metadata + grotesk headlines
    - install snippet in hero
    - proof/architecture/docs as first-class surfaces
- Likely files:
  - new planning memo
  - future `website-v2` tasks
- Acceptance criteria:
  - visual system is preserved
  - "enterprise security costume" language is filtered out unless substantiated

#### AP-018: Audit protocol-version and verification claims across `website-v2`

- Objective:
  Find and reconcile all site surfaces that touch Anchor, harbors, verification, V4, and remote capabilities.
- Why it matters:
  Website drift currently appears likely.
- Deliverables:
  - per-file audit list
  - claim-by-claim corrections
- Likely files:
  - `website-v2/src/data/product.ts`
  - `website-v2/src/pages/RoadmapPage.tsx`
  - whitepaper landing page
  - hero/product/security copy surfaces
- Dependencies:
  - claim taxonomy from AP-016
- Acceptance criteria:
  - no HMAC-vs-Ed25519 contradiction remains
  - page count, version, and verification language are aligned

#### AP-019: Rebuild the website IA around operator trust, not generic SaaS persuasion

- Objective:
  Preserve the mock’s sequence: hero, proof, architecture, monetization, docs.
- Why it matters:
  This structure is already doing useful explanatory work.
- Deliverables:
  - IA spec for `website-v2`
  - copy goals for each section
- Likely files:
  - website planning docs
  - `website-v2` page components later
- Acceptance criteria:
  - the site sells trust through artifacts and system diagrams, not lifestyle imagery or gradients

#### AP-020: Choose the right typography and identity system

- Objective:
  Avoid default-tech typography while preserving legibility and discipline.
- Why it matters:
  The current mock works despite some default font choices, not because of them.
- Deliverables:
  - font and identity guidance
  - usage rules for mono vs sans
  - guidance on accent color roles and section chips
- Likely files:
  - design memo
  - website styles later
- Acceptance criteria:
  - the final visual language feels structural and industrial, not trendy or cute

### Cluster F: Public Roadmap Translation

#### AP-021: Reconcile public roadmap with current recovery authority

- Objective:
  Decide whether the public roadmap continues to center the older V4 phase arc or starts reflecting `docs/recovery/CURRENT-WORK.md` priorities.
- Why it matters:
  Public roadmap and execution roadmap are diverging.
- Deliverables:
  - translation memo
  - proposal for what public roadmap should expose, suppress, or summarize
- Likely files:
  - `docs/V4-UNIFIED-ROADMAP.md`
  - public roadmap page
- Acceptance criteria:
  - public roadmap is not fiction
  - internal recovery priorities do not remain invisible forever

#### AP-022: Map graph activation to economic and marketing readiness

- Objective:
  Make explicit that the semantic graph is the missing bridge between trust substrate and economy narrative.
- Why it matters:
  Future agents are likely to misread this as copy work.
- Deliverables:
  - dependency note linking:
    - `graph_edges`
    - episodic memory
    - merge queue
    - evidence-backed economy claims
    - pricing/risk language
- Likely files:
  - roadmap
  - planning memo or claim registry
- Acceptance criteria:
  - future agents see graph activation as narrative infrastructure, not only engineering infrastructure

## Recommended Execution Order

1. AP-001 through AP-005
   Protocol paper honesty and verification-stack cleanup.
2. AP-010 through AP-013
   Layer separation in roadmap and ADRs.
3. AP-016, AP-018, AP-021, AP-022
   Website truth and roadmap synchronization.
4. AP-014 and AP-015
   Choose the external narrative and branding center.
5. AP-017, AP-019, AP-020
   Translate the visual system and IA into site execution.
6. AP-006 through AP-009
   Harden the daemon/security roadmap with realistic engineering depth.
7. AP-012
   Finalize monetization packaging once narrative and readiness truth are stable.

## Immediate Next Slice Recommendation

If only one next slice is taken, it should be:

- AP-001
- AP-002
- AP-003
- AP-010
- AP-016
- AP-018

Reason:
This combination fixes the most damaging truth drift first:
the paper, the roadmap language, and the website claims stop contradicting one another.

## Anti-Patterns For Future Agents

- Do not reduce this workstream to visual redesign alone.
- Do not treat the website as "marketing-only" copy.
- Do not conflate verified token behavior with runtime/OS enforcement.
- Do not present the economy as shipped if graph activation and readiness translation are still missing.
- Do not lead with remote market/auction claims before local operator trust and evidence-backed work agreements are believable.
- Do not discard the strong visual operator grammar from the `agentsd` mock just because some of its claims overshoot reality.

## Source Surfaces Consulted

- `docs/reports/PORT_DADDY_ANCHOR_WHITEPAPER.md`
- `docs/V4-UNIFIED-ROADMAP.md`
- `docs/adr/0014-the-anchor-protocol.md`
- user-provided batch 1 feedback and screenshots
- `v0-agentsd-main/`
- spider-style connection mapping from a sidecar review
