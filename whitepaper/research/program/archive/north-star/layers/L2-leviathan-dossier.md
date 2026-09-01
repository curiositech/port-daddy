"dossier": "Confirmed: read-surfaces (attention, briefing, resurrection, attest, pheromone, episodic-memory, skill-index) are BUILT; the whois router (`lib/router.ts`), TUI (`core/pd-tui`), and identity/commitments ADRs (0040/0041) are unbuilt/DESIGNED. The seeds' honesty labels check out. Here is the dossier.

---

# L2 Layer Dossier — The Leviathan (Legibility & Authority)
### The Wedge. For the human operator.

> **Mandate (verbatim):** *"My brief ideas weren't meant to be a spanning tree — I need brainstorming and expansion and debate on these layers. Push each layer avatar to be completionist and consistent."*

This dossier is the source the L2 paper (**The Legible Swarm**) is written from — not the three seeds (`legibility-leviathan.md`, `tokens-compaction.md`, `discovery-guilds.md`), which are inputs. The seeds are strong on *legibility-as-product*, *digest-with-zoom*, *read-poverty*, and *compaction-as-COGS*. They are thin on: **the authority half** (L2 is *legibility AND authority* — the seeds over-index on the reading and under-treat the deciding, blocking, escalating, and landing), **the operator's economy of attention as a scarce resource in its own right**, **the completionist obligation as a buildable mechanism** (not just a slogan), **the time-axis of legibility** (replay, provenance, the audit trail), and **the failure of the operator themselves** (trust calibration, alarm fatigue, the abdication gradient). The bulk of this dossier's net-new content is in §1.B, §2, and §3.

---

## 1. The complete idea-space

The North Star (ADR-0048) names L2 as five clusters: *summarization-with-zoom, roadmap-as-truth, adversarial review, completionist obligation, HiTL escalation*, plus the *read-surfaces* and the *ratatui console*. A completionist treatment must split this into **two halves the seeds blur into one** — **legibility** (the read side: making the swarm seeable) and **authority** (the write side: the Leviathan actually *deciding* and *acting*). The whole point of Hobbes is that the sovereign doesn't just *see* — it *rules*. The seeds nailed the seeing; the authority half is under-built.

### 1.A — The LEGIBILITY half (read-surfaces; the seeds cover most of this well)

**Primitives (the read-surfaces, each a digest-with-zoom):**
1. **Attention / Attention Queue** — `lib/attention.ts`, `cli/commands/attention.ts`, `GET /attention` [BUILT]. The agent-facing composer ("everything new for this actor"). The *operator*-facing **Attention Queue** (Distress / Requests / Signals lanes, ADR-0046) is the stakes-ranked projection [DESIGNED]. **This is the operator's scarce-resource allocator** — see §1.B.
2. **Briefing** — `lib/briefing.ts`, `GET /briefing` [BUILT]. The exemplary digest-with-zoom: daemon writes a `.portdaddy/` projection, agents read on startup, SQLite stays source of truth.
3. **Resurrection-with-memory** — `lib/resurrection.ts` [BUILT-WEAK]. Heartbeat-staleness → unfinished-work changelog for a successor. Honest gap: *passes notes, not checkpoints.*
4. **Attestation** — `lib/attest.ts`, `lib/attest-invariants.ts` [BUILT]. The *sovereign making its own acts legible* (ADR-0045). This is the bridge primitive between the two halves: it is a read-surface *of the authority*.
5. **Discovery / `pd whois`** — ADR-0030 [DESIGNED; `lib/router.ts` does not exist]. The cure for read-poverty: existence → relevance → trust directory layers. Composes built signals (skill-index, claims, episodic memory).
6. **Suggestibility** — ADR-0039 [DESIGNED]. Discovery turned inside-out: the substrate runs the query *for* the operator/agent, unprompted. "Read-poverty is nobody running the query; suggestibility runs it."
7. **The pure-ratatui operator console** — ADR-0046 [DESIGNED; `core/pd-tui` does not exist]. The seat. A **conversation multiplexer**, not a file browser. Legibility-with-zoom *enforced by the medium* (you cannot over-render in a terminal).

**Mechanisms:**
- **Digest-with-zoom** (the one law): summarize STATE, link to WORK; every summary is a lens, never a replacement.
- **Verifiable-zoom**: the canonical zoom target is operator-checkable (diff/test/row), not the agent's self-narration (Turpin et al. — unfaithful CoT).
- **Stakes-proportional friction** (the in-the-loop rule): friction scales with stakes; force a zoom on irreversible/low-confidence acts; batch low-risk; rotate forced spot-checks.
- **Compaction-as-digest** (the tokens seed): the digest IS compaction; PD already compacts in five primitives; compact-from-artifacts (never recurse on prose).
- **The four design questions** (the decision procedure) and **the recall→precision→zoom→compact-from-artifacts→meter quality gate**.

### 1.B — The AUTHORITY half (the Leviathan rules; the seeds under-treat this)

This is the half the title promises ("Legibility **&** Authority") and the seeds mostly skip. A read-only legibility layer is a glorified dashboard; the wedge is that the operator *consents to cede decision authority* to the daemon, and the daemon *acts*.

**Primitives & mechanisms (mostly DESIGNED/VISION; this is where the net-new completionist work lives):**

1. **Roadmap-as-truth** — the single legible artifact the authority is *accountable to*. ADR-0048's Implementation Matrices already key phases to `roadmap_items`; the Cartographer owns it. The authority's legitimacy is measured against *whether the roadmap stays true*. **Seeds missed this entirely** — they treat legibility as reading the swarm's *present*, never as the swarm's *plan being maintained*. The roadmap is the L2 object that makes "is the swarm doing the right thing?" answerable, distinct from "what is the swarm doing?"
2. **Adversarial review** — the authority's quality organ. A swarm that reviews its own work is two LLMs agreeing = one error twice (the verifiable-zoom corollary). Review must be *adversarial and conflict-free* (a reviewer with no stake), structurally (critique-refine protocol, bounded rounds, ADR-0047) — and it bridges to L3's neutral-evaluator reputation (Paper 3). **Seeds touch this only as "automatic adversarial review" in passing.**
3. **Completionist obligation as a buildable mechanism** — not a slogan. The operator's standing complaint is agents that *declare done while hollow* ("fixed the test by deleting it"). The completionist obligation is: a `done` claim is **structurally gated** by an attestation that the obligation's *acceptance criteria* (the ADR's "Done when:" clause) are met, verifiably. This is ADR-0045's honest-green discipline applied to *task completion*, not just *system health*. **Seeds list "completionist obligation" once (quoting ADR-0048) and never specify it.** This dossier proposes: **a completion is a commitment (ADR-0041) whose satisfaction predicate is a verifier, and the Arbiter regiments `done` against an unmet predicate.**
4. **HiTL escalation as a typed, prioritized interrupt** — the `escalate`/`distress` performative (ADR-0047) → the Distress lane (mayday-red, reserved) → the operator. The mechanism: **the one thing needing a human must win the pre-attentive race in <3s** (ADR-0046 Phase 7 blind-test). The *escalation policy* — *when* does the daemon stop and ask vs. proceed — is a control problem coupling stakes × agent-reputation × reversibility. **Seeds gesture at "HiTL when irreconcilable" but never specify the escalation predicate.**
5. **Thoughtful landing** — merge ordering, the merge-queue (`lib/merge-queue.ts`), harbormaster ownership. The authority decides *what lands and in what order*, conflict-aware. This is L2 authority acting on L1's commitments. **Absent from all three seeds.**
6. **Footgun-guards / regimentation** — the Arbiter (`lib/arbiter.ts` [BUILT]) and Coordination Guard make irreversible-on-stale-premise acts *unreachable*. This is the *enforcement arm* of the legible sovereign. The legibility seed lists footguns as a failure mode but treats the guard as L1; **it is the operator-facing authority's teeth and belongs in L2's story.**
7. **The legible-sovereign rule** (consent amendment) — the authority must be the *most* legible actor, not the least. Every claim-denial, Arbiter-block, escalation, attestation is a named, zoomable event. (The legibility seed has this — §3 — it is the one authority-half idea the seeds got right.)

### 1.C — The OPERATOR as a modeled entity (the seeds' biggest structural omission)

The seeds model the *swarm* as the thing made legible. They barely model the *operator* — yet L2 is "for the human operator," and the binding constraint at the top of the stack is **the operator's finite attention and fallible trust calibration.** A completionist L2 must treat the operator's attention as a resource with its own economics, parallel to the token economics of the swarm.

**Claims/mechanisms:**
- **The operator's attention is the scarcest resource in the whole stack** — scarcer than tokens, because it does not scale and cannot be spawned. The Attention Queue is fundamentally a *scheduler for one CPU that is a human*. The tokens-compaction seed argues tokens are "the only metered-and-meaningful resource"; **this is wrong at L2** — operator-attention-seconds are the *binding* meter, and the digest's real job is to *minimize operator-attention-seconds-per-correct-decision*.
- **Trust calibration is the operator's failure mode** (Bainbridge/Endsley, in the legibility seed §5) — but the seed stops at "rotate spot-checks." The completionist treatment: a *measured* trust-calibration signal — track operator approve-without-zoom rates, inject **canary defects** (known-bad diffs) at a sampled rate, measure catch-rate, and *raise forced-zoom friction when catch-rate drops*. This makes "are you actually in the loop?" a metered invariant, not a hope.
- **The abdication gradient** — as the avatar gains autonomy (ADR-0046 Phase 6, end-to-end roadmap execution), the operator's role degrades from *doer* → *approver* → *rubber-stamp* → *absent*. L2 must have a mechanism that *resists* the slide to rubber-stamp (forced anomaly surfacing, not throughput; periodic "the operator must do one thing manually" — a deliberate skill-retention tax). **No seed addresses operator skill atrophy.**

---

## 2. Gaps the seeds missed (concrete)

1. **The authority half is barely built out.** (See §1.B.) Roadmap-as-truth, thoughtful landing, adversarial review, and completionist-obligation-as-a-verifier are named in ADR-0048 but absent or one-line in the seeds. The paper must devote a full section to "the Leviathan *rules*, it doesn't just *watch*."

2. **Completionist obligation has no buildable spec.** Proposed here: **`done` is a commitment whose satisfaction predicate is a verifier derived from the ADR "Done when:" clause; the Arbiter regiments `done` against an unmet predicate; an unverifiable predicate must SKIP-loud (ADR-0045), never silently pass.** This is the single highest-leverage net-new mechanism — it directly answers the operator's "no Potemkin react apps / transparently hollow" standing rule.

3. **The operator-attention economy.** The tokens seed builds a beautiful COGS argument for *swarm* tokens but never crosses to the *operator's* attention budget — which is the actual binding constraint at L2. There is a dual paper hiding here: **attention-seconds-per-correct-decision** is the L2 objective function the digest minimizes, and it trades off against swarm token cost (a cheaper digest may cost more operator seconds). This coupling is unmodeled.

4. **The time-axis: provenance, replay, and the audit trail.** All three seeds treat legibility as a *snapshot* (what is the swarm doing *now*). Legibility *over time* — the replay scrubber (ADR-0046 dissenting appendix), `git_sha_at_annotation` provenance on every spray, the append-only event log that lets the operator answer "how did we get here?" — is a distinct legibility mode the seeds omit. **Scott's cadastral map is static; a swarm needs a legible *history*, because most operator decisions are forensic ("why did this land?").**

5. **Calibrating digest-with-zoom against the operator, empirically.** The legibility seed's open problem #1 ("how much zoom is enough?") is stated but the *measurement apparatus* (canary defects, catch-rate, attention-second accounting) is not. This dossier supplies it (§1.C).

6. **The pheromone/spray as an *authority* primitive, not just a read-surface.** ADR-0046 makes "spray a pheromone" a first-class key-bound *steering* verb — the operator *acting on* the swarm through the digest. The compaction seed treats pheromones only as decaying *read* state (§3.4). The operator-as-actor-through-the-digest (spray = "look here / this is wrong / prioritize this," revocable, lineage-tracked) is an authority mechanism the seeds don't connect.

7. **Multi-modal legibility / the FleetBar.** ADR-0045 turns FleetBar's icon red on a PASS→FAIL transition. There is an ambient, glanceable, *non-TUI* legibility channel (menu-bar color, opt-in sound, reduced-motion — ADR-0046 Phase 7) that complements the dense console. The seeds treat the TUI as the only surface; the *ambient* surface (one bit of legibility, always visible, pre-attentive) is a distinct and important design point.

8. **The cold-start / single-agent degenerate case.** Read-poverty is a *scale* disease; the discovery seed handles n=50–200. But the wedge ships to a solo dev who often runs **one or two** agents. L2 must be valuable at n=1 (the briefing, the attest, the footgun-guard, the honest `done`) and *gracefully grow* into the read-poverty regime. The seeds don't characterize the value curve across n.

9. **Compaction *quality* as a regimented invariant.** The tokens seed proposes "successor task-success-from-digest-alone" as a metric but leaves it as an open problem. A completionist L2 wires it into `pd attest`: a resurrection handoff whose digest fails a successor-replay smoke-test should *loud-fail*, not silently hand off a lossy summary.

10. **Discovery's relationship to the operator (not just agent-to-agent).** The discovery seed's `pd whois` is framed agent→agent. The operator *also* needs discovery — "which of my 50 agents should I look at *right now*?" is a discovery/ranking query over the operator's attention, which is exactly the Attention Queue's ranking function. **The seeds treat Attention Queue (legibility) and whois (discovery) as separate; they are the same ranker pointed at two readers.** Unifying them is a net-new structural claim.

---

## 3. Open problems (→ starred exercises)

1. **The forced-zoom sampling rate.** (From legibility seed, sharpened.) Given agent reputation $r$, action stakes $s$, reversibility $v$, what is the optimal forced-zoom probability $p(r,s,v)$ that keeps operator catch-rate above a floor while minimizing attention-seconds? Couples L2 legibility to L3 reputation. **Open control problem.** ★★

2. **The operator-attention objective function.** Formalize *attention-seconds-per-correct-decision* and prove (or bound) the trade-off against swarm token-COGS: does a cheaper (smaller) digest always cost more operator seconds, or is there a frontier? Is there a digest that is Pareto-optimal in both? **Unmodeled.** ★★★

3. **The compaction-quality scalar.** (Tokens seed open problem #1.) Is *successor-replay-success-from-digest* a sound, gameable-resistant metric? Can it be made an `attest` invariant cheaply (the successor-replay smoke test is itself token-expensive)? ★★

4. **Completionist verification of the unverifiable.** Some "Done when:" clauses are not mechanically checkable ("the design feels right"). What is the honest fallback — a forced HiTL gate? a neutral-LLM-judge with declared low confidence? When is "I cannot verify this completion" the correct, loud answer? ★★

5. **Adversarial legibility.** (Legibility seed open problem #4.) An agent that *knows* it is being made legible optimizes its narration to look good while the diff lies. Verifiable-zoom is partial; the complete answer needs L1 jail + L3 reputation penalty for narration-vs-artifact divergence. Can L2 *alone* detect divergence (a deterministic diff↔narration consistency check) before reputation exists? ★★★

6. **The abdication-resistance mechanism.** Does a deliberate "skill-retention tax" (periodic forced manual action) actually preserve operator situation awareness, or does it just annoy and get disabled? Borrow from aviation's manual-flight-hours requirements — is there a measured analog? ★★

7. **Calibrating `pd whois` weights with no ground truth.** (Discovery seed open problem.) There is no labeled "correct routes" dataset. Can the operator's *accept/reject* of suggestibility nudges serve as implicit relevance feedback to tune the five weights online — and does that feedback loop Goodhart itself? ★★

8. **The decay-vs-summary boundary.** (Tokens seed open problem #5.) A theory of *which compaction for which signal*: decay for coordination traces, summary for decisions, eviction+pointer for reconstructable artifacts. Currently only a heuristic. ★

9. **Legibility's lower bound (the information-theoretic question).** What must a digest *retain* to remain a faithful zoomable index — is there a minimum description length below which zoomability is impossible? Connects to recursive-summarization collapse. ★★★

---

## 4. Adjacency contract

### What L2 ASSUMES from L1 (the protocol) and L0 (the daemon)

- **From L0 (BUILT):** a single authoritative SQLite/WAL store of ports, claims, sessions, notes, pheromones, episodes — *the artifacts L2 computes digests over and zooms into*. L2's verifiable-zoom rule **depends** on L0 owning ground truth (not a model's summary). The daemon's append-only event history is the substrate for the time-axis / replay legibility (§2 gap #4).
- **From L1 (DESIGNED, ADR-0047):** **typed performatives** (`escalate`/`request`/`inform`/…) — L2's Attention Queue lanes (Distress/Requests/Signals) *are the performative taxonomy rendered*; without typed comms the queue is Potemkin. **Delegation chains + conversation IDs** — L2's "who is talking to whom about what" multiplexer reads these. **Commitments (ADR-0041) + their lifecycle** — L2's completionist-obligation mechanism *is a commitment with a verifier predicate*; L2 assumes L1 gives it `pending/active/satisfied/broken` states to gate `done` against. **Arbiter regimentation (ADR-0045)** — L2's footgun-guards assume L1 can make forbidden states unreachable. **Termination logic** — L2's "is this dialogue done?" reads L1's quiescence detection.
- **L2's explicit dependency on the unbuilt:** the Attention Queue, suggestibility, and the typed-comms-rendered console are **DESIGNED, blocked on L1 Phase 0–5**. L2's read-surfaces that are BUILT (attention/briefing/resurrection/attest) work *today over untyped tube*; they get *richer and honest* once L1 ships types. The paper must say this precisely.

### What L2 PROVIDES to L3 (the economy)

- **Legible continuity = the L3 keystone.** Resurrection-with-memory + episodic memory + briefing make an agent's *continuity* legible. This is the literal precondition for the through-line: *memory + checkpoint → continuity → person → reputation → asset → market*. **No legible continuity → no reputation → no tradeable agent.** L2 hands L3 a *findable, checkpointed, outcome-bearing identity*.
- **The completionist-`done` ledger feeds reputation.** Every verified completion (and every loud-failed one) is an outcome event. L3's reputation (Paper 3) is computed *over the outcome ledger L2 produces by gating `done`*. L2 is the **outcome witness**; L3 is the **scorer**.
- **The discovery directory becomes the appraisal/federation substrate.** `pd whois` (centralized, L2) is the seed that federates into L3's cross-operator directories + guilds. The Attention-Queue ranker and the whois ranker are the same function (§2 gap #10) — L3 adds a *trust* signal (reputation) as a sixth term.
- **Operator-attention economics is the denominator L3 cannot escape.** The tokens-as-COGS argument (compaction seed) hands L3 its *per-task token ledger*; L2 additionally hands L3 the *operator-attention cost* of supervising a rented fleet — a hosted-trust offering ("we make Alice's fleet legible to you") prices on it.
- **The legible-sovereign discipline transfers.** L3's hosted-trust product (verified ledger + relay + reputation) inherits L2's rule: every act of the trust-authority must be a named, zoomable, attestable event. A federated Leviathan is "a second Leviathan made of the first."

**Consistency obligations (per the mandate):** every L2 claim must cohere with — ADR-0048 (the stack, the legibility principle, the through-line), ADR-0047 (Attention Queue = performatives rendered; completionist `done` = a commitment), ADR-0045 (honest-green = the template for honest-`done` and the legible sovereign), ADR-0046 (the console is a conversation multiplexer, the medium enforces no-over-render, mayday-red reserved). The vocabulary key is fixed: **BUILT · BUILT-WEAK · DESIGNED · VISION** (the discovery seed's stray `[PROPOSED]` → `DESIGNED`).

---

## 5. Prior art to cite

**Already in the seeds (carry forward, deduplicated across the volume):**
- **Hobbes 1651**, *Leviathan* — consent to a sovereign to escape the state of nature; covenant *among subjects*, not with the sovereign.
- **Scott 1998**, *Seeing Like a State* — legibility, *mētis*, high-modernism, the Normalbaum collapse. The governing metaphor for over-flattening.
- **Rao 2010**, *A Big Little Idea Called Legibility* — ported Scott to software/org design.
- **Dai et al. 2024**, *Artificial Leviathan* (arXiv:2406.14373) — LLM agent societies *empirically* re-enact the Hobbesian arc. The anchor is observed, not metaphorical.
- **Bainbridge 1983**, *Ironies of Automation* — better automation deskills its supervisor; the out-of-the-loop seed.
- **Endsley & Kiris 1995**, *Out-of-the-Loop Performance Problem* — autonomy lowers the operator's ability to catch failure.
- **Turpin et al. 2023**, *Unfaithful CoT* (NeurIPS) — self-narration may be fiction; grounds verifiable-zoom.
- **Anthropic 2025**, *Effective Context Engineering* — compaction/notes/isolation; recall-then-precision; context rot.
- **Liu et al. 2024**, *Lost in the Middle* (TACL) — edge-vs-middle context use.
- **Nisan/Roughgarden/Tardos/Vazirani 2007**, *Algorithmic Game Theory* — externality-pricing for shared context (the L2→L3 bridge).
- **Ostrom 1990**, *Governing the Commons* — the shared-context-as-commons framing.
- **FIPA 00023** (Directory Facilitator), **Smith 1980** (Contract Net), **Kamvar et al. 2003** (EigenTrust), **Greif 1993 / Greif-Milgrom-Weingast 1994** (Maghribi / merchant guilds), **Stoica et al. 2001** (Chord), **Douceur 2002** (Sybil), **Fischer-Lynch-Paterson 1985** (FLP), **Conway 1968** (committees/communication structure), **Ongaro & Ousterhout 2014** (Raft — asymmetric authority + understandability as a measurable goal).

**Net-new prior art this dossier adds (for the authority half, the operator-attention economy, and the time-axis):**
- **Parasuraman, Sheridan & Wickens 2000**, *A Model for Types and Levels of Human Interaction with Automation* (IEEE SMC) — **the canonical 10-level automation taxonomy**; grounds the abdication gradient and the escalation-policy control problem (§1.C, §3.6). *Far stronger scaffolding for the authority half than the seeds' Bainbridge-only treatment.*
- **Parasuraman & Riley 1997**, *Humans and Automation: Use, Misuse, Disuse, Abuse* — **trust calibration** (over-trust vs. under-trust); grounds the canary-defect catch-rate mechanism (§1.C).
- **Lee & See 2004**, *Trust in Automation: Designing for Appropriate Reliance* (Human Factors) — the definitive treatment of *calibrated* trust; the operator-failure-mode literature the seeds gesture at.
- **Endsley 1995**, *Toward a Theory of Situation Awareness in Dynamic Systems* — the SA construct itself; what the digest must preserve in the *operator*, not just the data.
- **Wickens — Multiple Resource Theory** — attention as a *finite, allocable* resource; the formal basis for treating operator-attention-seconds as the binding meter (§1.C, §2 gap #3).
- **Tufte 1990**, *Envisioning Information* / **Shneiderman 1996**, *The Eyes Have It* ("overview first, zoom and filter, details-on-demand") — **the visual-information-seeking mantra is *literally* digest-with-zoom**; cite it as the established UX form, validating the rule as practice not invention.
- **Miller 1956**, *The Magical Number Seven* — the hard cognitive ceiling that makes read-poverty a human constraint, not just an engineering one.
- **Goodhart 1975 / Strathern 1997** — already in discovery seed; reuse for "top-of-Attention-Queue becomes a target agents farm."
- **Norman 1990**, *The 'Problem' with Automation: Inappropriate Feedback and Interaction* — feedback as the cure for the ironies; grounds the legible-sovereign rule from the HCI side (complements Hobbes from the political side).
- **(Optional, for the completionist-`done` mechanism)** **Meyer 1992**, *Applying Design by Contract* — pre/postconditions as machine-checkable obligations; the completion-predicate is a postcondition. Clean grounding for "`done` is a verifier, not a vibe."

---

## 6. Honest state (per ADR-0045 discipline; verified against the repo on disk)

| # | Claim / mechanism | State | Evidence |
|---|---|---|---|
| L | **Attention composer (agent-facing)** | **BUILT** | `lib/attention.ts`, `cli/commands/attention.ts`, `GET /attention` present on disk |
| L | **Briefing projection** | **BUILT** | `lib/briefing.ts` present; the exemplary daemon-writes/agents-read digest |
| L | **Resurrection handoff** | **BUILT-WEAK** | `lib/resurrection.ts` present; *passes notes, not checkpoints* (repo memory: "resurrection is weak") |
| L | **Honest attestation / legible sovereign** | **BUILT** | `lib/attest.ts` present; ADR-0045 Accepted; the sovereign-makes-its-own-acts-legible primitive |
| L | **Episodic memory (continuity substrate)** | **BUILT** | `lib/episodic-memory.ts` present |
| L | **Pheromone decay (forgetting-as-compaction)** | **BUILT** | `lib/pheromone.ts` present |
| L | **Skill index (capability yellow-pages)** | **BUILT** | `lib/shipwright/skill-index.ts`, `lib/semantic-resolver.ts` present |
| L | **Single LLM backend resolver (re-rank transport)** | **BUILT** | `lib/llm-backend-resolver.ts` present |
| L | **Arbiter regimentation (footgun-guard teeth)** | **BUILT** | `lib/arbiter.ts` (cited ADR-0045) |
| L | **Operator Attention Queue (Distress/Requests/Signals, stakes-ranked)** | **DESIGNED** | ADR-0046 Accepted; lanes = ADR-0047 performatives rendered; *not yet ranked into operator lanes* |
| L | **`pd whois` discovery router (relevance layer)** | **DESIGNED** | ADR-0030 Accepted; **`lib/router.ts` / `routes/router.ts` / `cli/commands/whois.ts` do NOT exist on disk** (verified) |
| L | **Suggestibility (substrate runs the query)** | **DESIGNED** | ADR-0039-suggestibility Accepted; no implementation |
| L | **Pure-ratatui operator console** | **DESIGNED** | ADR-0046 Accepted; **`core/pd-tui` does NOT exist** (verified); mockups live on `design/tui-fleetbar-mockups` |
| A | **Roadmap-as-truth (Cartographer-owned, phase-keyed)** | **BUILT-WEAK** | `roadmap_items` + Implementation Matrices exist (ADR-0048/0043); the *authority being held accountable to it* is DESIGNED |
| A | **Adversarial / conflict-free review as a structural organ** | **DESIGNED** | critique-refine protocol (ADR-0047 Phase 1); neutral-judge bridge to L3 (Paper 3 / ADR-0049) |
| A | **Completionist obligation as a verifier-gated `done`** | **VISION** | *Net-new mechanism proposed in this dossier;* no ADR specifies the `done`-as-commitment-with-predicate gate yet |
| A | **HiTL escalation as typed prioritized interrupt** | **DESIGNED** | `escalate`/`distress` (ADR-0047) → Distress lane / mayday-red bar (ADR-0046); escalation *predicate* unspecified |
| A | **Thoughtful landing / merge ordering / harbormaster** | **BUILT-WEAK** | `lib/merge-queue.ts` exists but *not wired*; harbormaster ownership DESIGNED |
| A | **Pheromone-spray as operator steering verb** | **DESIGNED** | ADR-0046 Phase 2 (`pheromones.spray` key-bound, revocable, lineage); spray primitive BUILT, the *operator-acting-through-digest* surface DESIGNED |
| O | **Operator-attention economy (attention-seconds objective)** | **VISION** | *Net-new in this dossier;* unmodeled in seeds and code |
| O | **Trust calibration via canary defects + catch-rate** | **VISION** | *Net-new;* proposed §1.C; no implementation |
| O | **Abdication-resistance / skill-retention tax** | **VISION** | *Net-new;* §1.C, open problem §3.6 |
| O | **Time-axis legibility (replay, provenance audit trail)** | **DESIGNED** | replay scrubber (ADR-0046 dissenting appendix), `git_sha_at_annotation` provenance; event-log substrate BUILT (L0) |
| O | **Ambient legibility (FleetBar red on PASS→FAIL)** | **BUILT-WEAK** | ADR-0045 Phase 6 watchdog → FleetBar red; FleetBar app exists, the continuous-watchdog wire is DESIGNED |
| O | **Compaction-quality as an `attest` invariant (successor-replay)** | **VISION** | *Net-new;* tokens-seed open problem #1 promoted to a regimented invariant |

**Honest summary of the wedge's state:** the **legibility read-surfaces are largely BUILT** (attention, briefing, resurrection, attest, pheromone, episodic, skill-index) but **the digest layer that unifies them into legibility-with-zoom is DESIGNED**, and **the entire AUTHORITY half — the Leviathan actually *ruling* (verifier-gated `done`, escalation policy, thoughtful landing, the operator-attention economy) — is DESIGNED-to-VISION.** The seeds accurately report the legibility half; this dossier's contribution is to surface that **L2's title promises authority the seeds under-deliver, and to specify the buildable mechanisms (completionist-`done`-as-verifier, the operator-attention objective, trust-calibration-by-canary, time-axis legibility) that close the gap** — each labeled honestly as the net-new VISION work it is. The wedge is real but *more than half-designed*: the safety and reading exist; the *deciding and landing* are the work that remains (ADR-0048 Phases 2–4).",