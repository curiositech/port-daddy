I now have a complete picture: the trilogy already formalizes claim-signaling IC (repeated-game folk theorem), the Cleanup Lower Bound, single-machine and cross-harbor Conservation, bounded escrow, federated revocation convergence, Sen's theorem on advisory claims, Merkle Forest portfolio proofs, and Youle's competitive-insurance contribution. The seeds add the three-sided-market framing and the identity→reputation chain. I can now write the completionist dossier.

# LAYER DOSSIER — L3: The Economy & Federation (the Market Between Operators)

> **Avatar scope.** This rung sits atop L2 (legibility/authority/the wedge), which sits atop L1 (the coordination protocol), which sits atop L0 (the daemon). L3 is the only layer whose *whom* is plural and **mutually distrusting**: two or more operators, each owning a fleet, trading labor/capital/IP across a boundary neither controls. Everything below L3 is single-operator and needs no cryptography; L3 is exactly the layer where "I own every machine" stops being true (ADR-0048). This dossier is the source the L3 papers (Paper 3 *From Spawn to Person*, Paper 4 *The Harbor Economy*) are written from — not the seeds.

---

## 1. The complete idea-space

The seeds cover three regions well — the identity→reputation chain, the three-sided market, and (in the trilogy LaTeX) the formal escrow/conservation/revocation machinery. A completionist L3 must hold **eight** sub-domains. I enumerate every primitive, mechanism, obligation, and claim each must carry.

### 1.A — Durable identity (the root the whole layer hangs from)
- **Primitives:** daemon-minted opaque `actor_id` (ULID) bound to a non-re-pickable credential (per-actor signing key or actor-soul body-lease, ADR-0040); the self-asserted `project:stack:context` string demoted to a display alias (`lib/actor-roster.ts`); the **principal** above the actor (the human/org that owns a fleet) — the delegation chain's terminus.
- **Mechanisms:** newcomer policy as a *shape* not a scalar (full work ability, reduced economic ceiling) (Friedman–Resnick); credential rotation without identity reset; the actor-soul / body-lease split (ADR-0022) as the Locke "substance vs. consciousness" line.
- **Obligations:** identity churn must cost more than a clean record is worth; a sanction must survive a respawn.
- **Claims:** *a reputation system is exactly as real as the identity it keys on.* (Load-bearing, and the seed states it well.)

### 1.B — Continuity (the three organs)
- **Primitives:** memory (`lib/episodic-memory.ts`, BUILT); checkpoint (resurrection, `lib/resurrection.ts`, BUILT-WEAK — passes notes not state); **the outcome ledger** (durable commitments, ADR-0041, DESIGNED) — the transitive Parfitian chain made concrete.
- **Claims:** reputation keys on the *third* organ (the witnessed-outcome ledger), not the memory stream — memory makes an agent *feel* continuous; the ledger makes it *be* an accountable principal.

### 1.C — Reputation as a substrate, not a score
- **Primitives:** the witnessed-outcome record (oracle-closed commitments); the **multi-dimensional** quality vector — *accuracy / aesthetics / efficiency* — judged by **neutral, conflict-free evaluators** ("the harbor's universities and rating agencies"); the explicit non-property "**never ends**" (no decay window an agent can outrun); the explicit anti-frame "**NOT a bandit problem**."
- **Mechanisms:** the estimator family (Elo / Bradley–Terry / TrueSkill) chosen by signal type (BT for full-history static populations, which a SQLite harbor *is*; TrueSkill σ for cold-start uncertainty); learned-outcome routing as the *internal* read of the same score that a *federated buyer* reads externally; de-biased LLM-as-judge for agentic reviews (order-swap, pairwise, family-exclude).
- **Claims:** *the score is cheap and last; the substrate it scores over (witnessed outcomes on a non-forgeable id) is the gate.* Reputation measures **reliable delivery, not quality** — quality needs adversarial QA on top (the honest ceiling).

### 1.D — The bond ledger (the conserving substrate, BUILT)
- **Primitives:** wallet, escrow row, commons pool; the conservation invariant `wallet + escrow + commons = supply` (10k-trace property test, BUILT); no-spawn-without-bond.
- **Mechanisms:** the four terminal settlement states (success / partial / sabotage / dispute) with flow-of-funds and reputation effect; oracle-bound closure (the agent picks the work, the daemon derives the grade); the **Cleanup Lower Bound** (the bond must dominate the worst-case cleanup cost `c`, proven in agent-transactions).
- **Claims:** conservation is the *mathematical glue* of a three-sided market — three settlement paths are coherent only if no path can leak.

### 1.E — The float plan & escrow ceremony
- **Primitives:** the signed `FloatPlan` (task + machine-checkable acceptance criteria + compute budget + credit bounty, ADR-0014); the ed25519 three-step ceremony (requester signs → daemon EXCLUSIVE-txn debits + escrows → daemon signs `{anchor_id, plan_hash}`).
- **Claims:** "no-spawn-without-bond" — work that can cost the commons cannot begin until value is pinned against it.

### 1.F — The three-sided market (the shape)
- **Sides (by incentive constraint, not UI tab):** (1) **operator-for-hire** (labor; margin = bounty − Σ slashed sub-bonds − fee; internalizes its fleet's risk like a firm); (2) **agent/fleet as rentable asset** (capital; owner bears reputational consequence, renter holds the runtime control right); (3) **skill/tool as licensed good** (IP; metered + clawback, paid only on green settlement).
- **Mechanisms:** all three ride **one** float-plan escrow → global conservation without a second ledger; price *structure* (who subsidizes whom) is the design lever, not price level (Rochet–Tirole); the Arbiter jail as the **residual control right** that makes leasing contractible (Grossman–Hart); metered+clawback+Merkle portfolio proof as the lemons-defense for opaque skills (Akerlof); the triple cold-start with subsidize-supply-then-flip.
- **Canonical honesty:** *"a three-sided market by design; two-sided until reputation ships."*

### 1.G — Federation (across machines you don't own)
- **Primitives:** harbor sovereignty (a property characterization, federated-harbor §def); the **witness log** (per-harbor Merkle root committed across the federation); inter-harbor scope; the **relay / Lighthouse / harbor-mesh** (ADR-0027) carrying public-key attestation.
- **Mechanisms:** the four-message cross-harbor capability-transfer ceremony (composes with Anchor; attenuation-monotonic across the boundary); **bounded escrow** (worst-case extraction = the pre-agreed fee φ; *trusted-but-bounded*, not trustless HTLC); cross-harbor conservation (in-flight bonds accounted as in-escrow); the bonded-sponsor admission pattern; **revocation gossip** with a convergence bound + cuckoo-filter discipline + cross-harbor conflict resolution.
- **Claims:** federation is sound iff revocation converges fast enough that a revoked capability cannot be spent during the propagation window; the escrow *cannot steal* (bounded by φ).

### 1.H — Hosted trust as the moat (the business claim)
- **Primitives:** verified ledger + relay + reputation hosting.
- **Mechanisms:** rail/product separation (x402/AP2/UCP/ACP/Stripe/credits are interchangeable substrate — and per ADR-0094 the harbor boundary now speaks AP2's credential formats, so "interchangeable" is an implemented interface, not a slogan); revenue from *successful* trade (txn fee 2–5%, small listing fee for collusion deterrence, tiny bond-spread kept small so the platform never profits from over-slashing).
- **Claims:** *you don't sell crypto — crypto is the substrate; you sell hosted trust.* The defensible asset is attestation + federation membership + reputation, not the commoditized payment rail.

---

## 2. Gaps the seeds missed

Concrete mechanisms/edge-cases a completionist L3 requires that are absent or under-specified in the seeds:

1. **The principal layer above the actor.** Both seeds talk about agent identity and ADR-0040, but the *economic* counterparty in every trade is the **principal** (the human/org owning a fleet), not the agent. Bonds, reputation inheritance, and sanctions must key on the principal-via-delegation-chain (agent-transactions §youle:a5 gestures at this with `C_kyc`), or Sybil bond-farming works by spawning fresh *agents* under one principal. The seeds never cleanly define the principal as a first-class economic entity. **This is the cleanest fix for Sybil bond-farming** and it deserves its own definition.

2. **Reputation aggregation across the three quality axes is unspecified.** The seed asserts accuracy/aesthetics/efficiency are *separate* axes judged by *separate* experts — but never says how a buyer reading a profile *combines* them, or whether they combine at all. Open design: do you publish a 3-vector and let the buyer weight it (operator's "cheap vs. careful" preference vector, which the routing seed already has)? Vector reputation + buyer-supplied weights is the natural answer and it is *not in the drafts*. Without it, "multi-dimensional reputation" is a slogan.

3. **Who pays the neutral judges, and what stops judge-capture?** The seed names "neutral, conflict-free evaluators" (universities/rating agencies) but never closes the incentive loop: a paid judge has a client; an unpaid judge doesn't scale; a judge that's another LLM backend has self-enhancement bias (the seed catches *that* but not the funding). **The judges need their own bond and their own reputation** — a judge whose ratings are later contradicted by re-audit gets slashed. This recursion (rating the raters) is missing and is a real Goodhart surface.

4. **Reputation revocation / repair.** Federation has revocation *gossip for capabilities*. But what about revoking a *reputation claim* later found fraudulent (a colluding judge, a faked oracle)? There is no specified path to **retract a settled outcome** and propagate the correction across harbors. "Reputation never ends" (seed) makes this *worse*: if it never decays, a poisoned data point is permanent unless you can surgically revoke it. The append-only ledger needs a **compensating-entry / tombstone** discipline (sagas-style), not in-place mutation. Missing.

5. **Float-plan renegotiation and partial-progress under scope drift.** The four terminal states include "partial," but the seeds never handle the mid-flight case where the *acceptance criteria themselves* turn out wrong (the task was under-specified — the common real case). Need a **float-plan amendment protocol** (re-sign by both parties, escrow top-up/refund delta, conservation preserved) — otherwise every under-specified task lands in "dispute," which doesn't scale.

6. **The fourth side: underwriting (Youle's competitive insurance).** The agent-economy-anchor seed *flags* Youle's insurer-agent proposal as an open "fourth potential side" but punts on whether it composes. The trilogy actually *works the cartel/IC math* for insurer pricing (agent-transactions §youle:a6, grim-trigger folk theorem). A completionist treatment must **resolve** whether competitive underwriting is a genuine fourth side or collapses into asset-rental — and the LaTeX already has the machinery to decide it. The seeds leave money (literally a side of the market) on the table.

7. **Multi-homing across harbors.** Rochet–Tirole's single- vs. multi-homing result governs equilibrium, and the seed *names* it as a corollary but never develops it: can an agent/skill list on *multiple* harbors simultaneously? If yes, reputation must be portable (federation paper) *and* you get cross-harbor cartel risk (federated-harbor §lim-cartel flags it). The interaction between multi-homing and reputation portability is the load-bearing federation economics question and it's undeveloped.

8. **Settlement currency / unit-of-account.** The bond ledger conserves an abstract `supply`. But across harbors, *whose* credit? The seed says the rail is swappable (x402 etc.) but never specifies the **unit of account** for cross-harbor settlement (fixed peg? floating exchange between harbor credits? a clearing unit?). Cross-harbor conservation (federated-harbor §cross-conservation) is proven *in one unit*; multi-currency settlement breaks the clean invariant. Missing entirely.

9. **Dispute resolution as a market, not a service.** The four-state model has "dispute → 2-of-3 multi-oracle (automated/evidence/human)." But the *human* oracle is a scarce, expensive resource and the seeds treat it as free infrastructure. At scale, arbitration is itself a priced service with its own queue, SLA, and incentive to rubber-stamp. The Ostrom "appeals window" is named but the **economics of arbitration capacity** is missing.

10. **Skill versioning & the moving-target portfolio.** A licensed skill's reputation is built on past settled outcomes — but skills get *updated*. A portfolio proof for skill v1 says nothing about v2. Need a **version-binding** in the Merkle portfolio proof (reputation attaches to a content hash, new version starts with a discounted inherited prior — same shape as the newcomer policy but for *code*). The lemons problem reappears at every version bump. Missing.

11. **Operator exit / harbor death.** What happens to escrowed bonds and outstanding reputation when an *operator leaves the federation* or their harbor dies mid-settlement? Federation has partition-tolerance (federated-harbor §partition) and equivocation defenses, but **graceful and ungraceful operator exit** (escrow orphaning, in-flight float plans, reputation tombstoning) is not specified. This is the L3 analogue of the L0 resurrection problem, one layer up.

12. **Collusion between requester and worker against the commons.** The seeds defend against worker-defects-on-requester and Sybil. But a *colluding* requester+worker can wash-trade fake settled outcomes to mint reputation cheaply (a self-dealing reputation pump). The listing fee is named as "collusion deterrent" but the wash-trading attack specifically — and its defense (cost-per-settled-outcome must exceed reputation's marginal value; sampled adversarial re-audit of *high-velocity counterparty pairs*) — is under-developed.

---

## 3. Open problems (→ starred exercises in the papers)

These are genuinely unsolved at this layer. The trilogy and seeds either conjecture or punt.

1. **Price of anarchy when reputation is itself for sale.** agent-transactions bounds PoA at 1:1 only in the limit (full-cleanup bonds, *bounded* reputation noise). The third side makes reputation a *strategic instrument*, not just a signal. Bounding PoA when reputation can be traded/leased is **open** (agent-economy-anchor §8.1).

2. **Eliminating the self-improvement arms race.** Chiu–Zhang–van der Schaar (2025) show competitive agents over-invest in self-improvement, burning surplus despite individual rationality. Does capping the reputation signal's marginal return restore efficiency, or just relocate the waste? **Open** (§8.2).

3. **Trustless cross-harbor settlement for non-fungible, reputation-priced bonds.** The federation paper proves *bounded* escrow (extraction ≤ φ) but explicitly **conjectures trustless settlement is impossible** for non-fungible reputation-priced bonds (vs. HTLC for fungible value, Herlihy 2018). Proving or refuting this conjecture is open and is the deepest crypto-economic question in the layer.

4. **Equivocation propagation speed vs. revocation convergence.** Federated revocation has a convergence bound, but a malicious witness can equivocate; whether revocation always outruns equivocation under realistic gossip topologies is open (federated-harbor §lim-equiv).

5. **Cartel formation across federations.** Multi-homing + portable reputation enables cross-harbor cartels. No mechanism currently bounds this (federated-harbor §lim-cartel). The correlated-equilibrium multi-principal extension (§lim-correlated) is the proposed but unsolved frame.

6. **Does competitive underwriting (Youle) compose, or collapse?** Whether insurer-agents bidding to underwrite transactions is a genuine fourth side or folds into asset-rental — and whether market-discovered bond prices preserve the Cleanup Lower Bound — is open (agent-economy-anchor §8.4).

7. **Aggregating the multi-dimensional reputation vector without re-introducing a single Goodhart target.** If you publish a 3-vector and let buyers weight it, do agents Goodhart the *most-weighted* axis? If you publish a scalar, you've recreated the bandit framing the seed explicitly rejects. The right disclosure form for vector reputation is open. **(New — flows from Gap #2.)**

8. **Reputation-claim revocation propagation with an append-only, never-decaying ledger.** How do you surgically retract a fraudulent settled outcome across N harbors, prove the correction converged, and bound the window during which the poisoned reputation was spendable — without violating append-only? **(New — flows from Gap #4.)**

9. **Cross-harbor unit-of-account.** Is there a settlement clearing unit that preserves cross-harbor conservation under floating exchange between heterogeneous harbor credits, or must federation mandate a single peg? **(New — flows from Gap #8.)**

10. **Incentive-compatible arbitration capacity.** A market for human/automated arbitration where arbiters are bonded, rated, and slashable for later-overturned rulings — does it converge to honest rulings, or to rubber-stamping under load? **(New — flows from Gap #9.)**

---

## 4. Adjacency contract

This is the formal interface that guarantees the stack coheres. **Precise** assumptions and provisions.

### What L3 ASSUMES from below (L2 / L1 / L0)
- **From L0 (BUILT):** a conserving bond ledger with the `wallet + escrow + commons = supply` invariant and no-spawn-without-bond (`lib/bonds.ts`); SQLite/WAL EXCLUSIVE transactions for the escrow ceremony; the cost ledger (`lib/cost-ledger.ts`); episodic memory (`lib/episodic-memory.ts`).
- **From L1 (DESIGNED, ADR-0047/0041):** oracle-bound commitment closure — *the agent picks the work, the daemon derives the grade* (this is the source of every "registered outcome" L3 reputation keys on); the Arbiter as the enforcement arm; capability attenuation (Anchor) so a cross-harbor transfer can only *narrow* authority.
- **From L1-safety (DESIGNED):** the **Arbiter jail** (tool-allowlist + scoped-FS per agent). L3 *requires* this as the **residual control right** (Grossman–Hart) that makes asset-rental contractible at all. Without the jail, the rental side is not safe to operate — this is a hard dependency, stated.
- **From L2 (the wedge):** the read-surfaces and the **non-forgeable identity** (ADR-0040). L3's single hardest precondition. Every L3 claim that depends on it must say so in one clause; the canonical sentence is: *"the score is cheap; the substrate it scores over — witnessed outcomes on a non-forgeable id — is the gate."*
- **From the legibility principle (ADR-0048) + honest-attestation (ADR-0045):** a reputation profile is a *digest that zooms to the witnessed evidence chain*, never a replacement for it. A score with no drill-down to the oracle-closed outcomes is theater.

### What L3 PROVIDES to the layer above (the market / federation / "L3+")
- **A priced, federated reputation** that a counterparty you don't own can read and verify (the third side's existence condition).
- **Hosted trust:** a verified ledger + relay + reputation, swappable underneath any payment rail.
- **Cross-harbor conservation:** the single-machine invariant extended so federated value cannot leak (in-flight bonds accounted as in-escrow).
- **Bounded escrow:** a *trusted-but-bounded* settlement third party that provably cannot extract more than its pre-agreed fee φ.
- **For L3+ research:** the substrate for role-scoped vocational memory, backend-scoped reputation priors, harbor-scoped team memory, and (dangerously) evolutionary agent-breeding — all of which *inherit reputation*, so all of which re-introduce the whitewashing risk at the lineage level and must gate accordingly.

### The single consistency invariant across the boundary
**Conservation composes upward.** L0 proves `wallet + escrow + commons = supply` per harbor (property-tested). L3's three sides are debits/credits *within that same ledger*, and federation adds only an in-escrow accounting term for in-flight bonds. Therefore no L3 mechanism — rental, licensing, underwriting, cross-harbor settlement — may introduce a settlement path that creates or destroys value. **Any L3 design that needs a second ledger has broken the contract.**

---

## 5. Prior art to cite

| Author (year) | Work | One-line relevance |
|---|---|---|
| Hobbes (1651) | *Leviathan* | The consent-to-a-sovereign frame; L3 is the *cross-operator* Leviathan where consent is voluntary federation, not local rule. |
| Locke (1689) | *Essay Concerning Human Understanding*, Bk II.xxvii | Memory criterion of personal identity → actor-soul vs. body-lease. |
| Parfit (1984) | *Reasons and Persons* | Psychological *continuity* (transitive) vs. *connectedness* → reputation keys on the transitive outcome-ledger, not the memory stream. |
| Akerlof (1970) | *The Market for Lemons* | Opaque skill quality → metered + clawback licensing, not flat upfront. |
| Rochet & Tirole (2003, 2006) | *Two-Sided Markets* | Price *structure* (not level) is the lever; single- vs. multi-homing governs equilibrium. |
| Armstrong (2006) | *Competition in Two-Sided Markets* | Multi-homing across competing harbors. |
| Grossman & Hart (1986); Hart & Holmström (2016 Nobel) | Incomplete-contracts / residual control rights | The renter must hold the runtime jail; the bond bridges the un-contractible gap. |
| Myerson (1981) | *Optimal Auction Design* | Revelation principle / revenue equivalence → settlement should be a direct incentive-compatible mechanism. |
| Friedman & Resnick (2001) | *The Social Cost of Cheap Pseudonyms* | Whitewashing; newcomer policy as a *shape* (full work, reduced ceiling). |
| Douceur (2002) | *The Sybil Attack* | Free identities defeat reputation/quorum → daemon-minted non-forgeable id. |
| Resnick, Zeckhauser et al. (2006) | *The Value of Reputation on eBay* | ~8% measured reputation price premium — the third side's empirical value. |
| Tadelis (2016) | *Reputation and Feedback Systems in Online Platform Markets* | Feedback systems as the platform answer to adverse selection. |
| Elo (1978); Bradley & Terry (1952) | Rating systems | BT is the full-history MLE a SQLite harbor is in; Elo its online special case. |
| Herbrich, Minka, Graepel (2007) | *TrueSkill* | Calibrated σ for cold-start uncertainty — the principled cold-start signal. |
| Zheng et al. (2023) | *Judging LLM-as-a-Judge* | Position/verbosity/self-enhancement bias → blind, order-swap, pairwise, family-exclude. |
| Chiu, Zhang & van der Schaar (2025) | *Strategic Self-Improvement for Competitive Agents in AI Labour Markets* (arXiv:2512.04988) | Independently models a three-sided agent labor market; surfaces the surplus-burning arms race. |
| Ostrom (1990) | *Governing the Commons* | Boundaries, monitoring, graduated sanctions, dispute resolution, appeals window. |
| Nisan, Roughgarden, Tardos, Vazirani (2007) | *Algorithmic Game Theory* | Incentive compatibility; price of anarchy. |
| Herlihy (2018) | *Atomic Cross-Chain Swaps* (HTLC) | The trustless-settlement baseline the bounded escrow consciously *departs* from. |
| Strathern (1997) | Goodhart's law (canonical statement) | "When a measure becomes a target it ceases to be a good measure" — score as telemetry, gate on predicates. |
| Garcia-Molina & Salem (1987) | *Sagas* | Compensating transactions → the reputation-revocation/tombstone discipline (Gap #4). |
| Casper / Tendermint (PoS slashing) | Crypto-economic bonding | Direct ancestor of slash-on-breach; the trilogy documents the three departures. |
| Sen (1970) | *The Impossibility of a Paretian Liberal* | Why enforced allocation is impossible → advisory claims (the trilogy's Advisory Conflict Completeness theorem). |
| Thomas Youle (2026, collaborator) | Competitive-insurance underwriting proposal | The possible fourth side: insurer-agents auction bond prices, replacing static π. |

---

## 6. Honest state (per major claim — BUILT / BUILT-WEAK / DESIGNED / VISION)

Consistent with shipped code (`lib/`), the ADRs present, and ADR-0045 discipline. **The canonical key:** `BUILT` · `BUILT-WEAK` · `DESIGNED` · `VISION`.

| # | Claim / mechanism | State | Evidence / grounding |
|---|---|---|---|
| 1 | Bond ledger: escrow, slash, commons pool | **BUILT** | `lib/bonds.ts` |
| 2 | Conservation invariant `wallet+escrow+commons=supply` | **BUILT** | `tests/unit/bonds-conservation-property.test.js` (10k-trace property test) |
| 3 | No-spawn-without-bond | **BUILT-WEAK** | `lib/bonds.ts` enforces escrow-first; the runtime `running`-state check is documented as Phase-2 (`lib/actors.ts`, unbuilt), so the gate is caller-discipline today, not runtime-enforced |
| 4 | Cost ledger / cost tracking | **BUILT** | `lib/cost-ledger.ts`, `lib/cost-tracker.ts` |
| 5 | Episodic memory (continuity organ 1) | **BUILT** | `lib/episodic-memory.ts` |
| 6 | Resurrection / checkpoint (continuity organ 2) | **BUILT-WEAK** | `lib/resurrection.ts` — passes *notes*, not state; "resurrection with teeth" is the goal, not the reality |
| 7 | Outcome ledger (continuity organ 3 — what reputation keys on) | **DESIGNED** | ADR-0041 durable commitments + obligation monitor; `lib/commitments.ts` exists but oracle-bound closure is the designed contract |
| 8 | Non-forgeable actor identity (the architectural bottleneck) | **DESIGNED** | ADR-0040; today identities are self-asserted strings (`lib/actor-roster.ts`, BUILT-but-forgeable) |
| 9 | Float plan + ed25519 escrow ceremony | **DESIGNED** | ADR-0014 Anchor Protocol; not wired to `lib/bonds.ts` end-to-end |
| 10 | Anchor Protocol (capability tokens, signed delegation, attenuation) | **DESIGNED** (formally verified) | anchor-protocol-whitepaper.tex — ProVerif + Kani verified *as a model*; no shipping `lib/` implementation |
| 11 | Reputation estimator (Elo/BT/TrueSkill) | **DESIGNED → VISION** | `lib/reputation.ts` doesn't exist yet; ADR-0048 phase-6 gated on phase-5. The *design* is specified; nothing scores yet |
| 12 | Multi-dimensional reputation (accuracy/aesthetics/efficiency, neutral judges, never-ends) | **VISION** | Stated in seeds + ADR-0049 (pending); no spec for axis-aggregation or judge funding (Gaps #2, #3) |
| 13 | Learned-outcome routing | **VISION** | Bandit/UCB routing template cited; not built |
| 14 | Three-sided market (operator-for-hire / asset-rental / skill-licensing) | **DESIGNED, two-sided in reality** | Canonical honesty: *"three-sided by design; two-sided until reputation ships."* Sides 2 & 3 *exist iff* ADR-0040+reputation ship |
| 15 | Asset-rental residual-control-right (Arbiter jail) | **DESIGNED** | Grossman–Hart mapping is sound; the L1 jail is not fully shipped, so the rental side is "not safe to operate" today — stated |
| 16 | Skill licensing (metered + clawback + Merkle portfolio proof) | **DESIGNED** | Merkle-forest inclusion proof (~700 B) specified in agent-transactions; cross-harbor verifiability undeployed |
| 17 | Float-plan claim-signaling incentive-compatibility (repeated-game folk theorem) | **DESIGNED** (proven in model) | agent-transactions §claim-signaling-ic — explicit deviation analysis, critical-δ condition |
| 18 | Cleanup Lower Bound (bond ≥ worst-case cleanup cost) | **DESIGNED** (theorem) | agent-transactions Thm `cleanup-bound` |
| 19 | Advisory Conflict Completeness (Sen → advisory claims) | **DESIGNED** (theorem) | agent-transactions Thm `advisory` |
| 20 | Federation: harbor sovereignty, witness log, four-message capability transfer | **DESIGNED** | federated-harbor-whitepaper.tex; no relay/mesh `lib/` implementation |
| 21 | Bounded escrow (extraction ≤ φ; trusted-but-bounded) | **DESIGNED** (theorem) | federated-harbor Thm `fh-escrow-bound`; trustless variant **conjectured impossible** (open) |
| 22 | Cross-harbor conservation | **DESIGNED** (property) | federated-harbor Prop `fh-cross-cons` + TLA+ extension |
| 23 | Federated revocation convergence + cuckoo-filter gossip | **DESIGNED** (theorem) | federated-harbor Thm `fh-conv`; equivocation-vs-convergence race open |
| 24 | Relay / Lighthouse / harbor-mesh | **DESIGNED** | ADR-0027; no shipping code |
| 25 | Competitive-insurance underwriting (Youle, the possible 4th side) | **VISION** | Cartel/IC math worked in agent-transactions §youle; composition with the three sides unresolved |
| 26 | Hosted-trust moat + rail/product separation | **DESIGNED** (positioning) | A defensible-strategy claim grounded in the commoditized 2025–26 payments stack (AP2/ACP/x402); not a code artifact |
| 27 | Principal-as-economic-entity, reputation-revocation/tombstone, float-plan amendment, cross-harbor unit-of-account, arbitration market, skill-versioned portfolio, wash-trade defense | **VISION** (gaps) | §2 Gaps #1, #4, #5, #8, #9, #10, #12 — named here, unspecified anywhere |

**One-line honest summary of the layer:** *Port Daddy's L3 has a BUILT conserving bond ledger and the BUILT organs of continuity (memory), a BUILT-WEAK checkpoint, and a richly DESIGNED-and-model-verified protocol stack (Anchor, Bonded Commons, Federated Harbor) — but the spine the market actually trades on (non-forgeable identity → outcome ledger → reputation) is DESIGNED-to-VISION, so today the harbor economy is a two-sided market with a proof-backed roadmap to three, not a running market.*",