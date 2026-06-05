I now have enough grounding. Key honest-state findings:
- `commitments.ts` exists with state machine (`open/done/abandoned/superseded`), daemon-owned deadlines, breach monitor — BUILT, but lacks GPGP enrichment (no negotiability/power-factor/relationship-type/`C(DL)` vs `C(Do)`).
- `delegation-chain.ts` is BUILT but it's the *cryptographic* multi-hop chain (anchor-protocol replay protection), NOT the loop-detection / ping-pong / upward-block semantics ADR-0047 describes. That's a critical distinction.
- `tube.ts` has a versioned envelope with `inReplyTo` but NO `performative`, NO `conversationId`, NO `delegationChain` — so the performative taxonomy is DESIGNED.
- No contract-net / cfp / bid anywhere — DESIGNED.
- `arbiter.ts` BUILT (regimentation); `pheromone.ts` BUILT with decay/TTL.

Now I'll write the dossier.

# L1 — The Coordination Protocol: Layer Dossier
### The Agent OS / Control Plane — "the rules of the road agents speak by"

> **Avatar mandate (verbatim):** *"My brief ideas weren't meant to be a spanning tree — I need brainstorming and expansion and debate on these layers. Push each layer avatar to be completionist and consistent."*
>
> This dossier is the source the paper is written from — **not** ADR-0047's seeds. ADR-0047 gives a keystone (typed performatives) and four mechanisms (protocol patterns, GPGP-enriched commitments, deontic binding, delegation/termination). That is a *spanning subtree*, not the *space*. Below is the full idea-space, the gaps the seed left, the genuinely open problems, the adjacency contract to L0 below and L2 above, the prior art, and an honest BUILT/DESIGNED ledger checked against the shipped code.

---

## 1. The complete idea-space

L1 is the layer where a *swarm* becomes a *conversation*: a set of agents that share an L0 substrate (ports, claims, tube, pheromones, commitments, Arbiter) but, without L1, exchange only opaque bytes and implicit hope. L1 supplies the **semantics** that make those bytes a dialogue with intent, ownership, obligation, provenance, and an end. For the stack to hold, L1 must be completionist across **eight families**. ADR-0047 names families A–D; E–H are the completion.

### A. The message layer — typed performatives (the keystone)
- **A1. The performative vocabulary.** A FIPA-ACL-narrowed set of communicative acts (`inform`, `request`, `propose`, `cfp`, `agree`, `refuse`, `failure`, `cancel`, plus PD's `critique`, `decide`, `finalize`, `escalate`/`distress`). The seed has this table. *Missing:* the **felicity conditions** of each act (a `request` is only well-formed if the sender believes the recipient *can* and *does not already intend to* — Searle/FIPA SL preconditions), and the **rational-effect vs. perlocution** split (FIPA defines what the *sender intends*; PD must define what the *daemon records as having happened* — these are not the same and the gap is where lies live).
- **A2. The envelope.** Versioned, with `conversationId`, `inReplyTo`, `delegationChain`, `performative`, `ontology`/`protocol` tag, `sender`/`receiver` identity (ADR-0040), `reply-by` deadline, `language`/`encoding`. The seed lists the first four. *Missing:* `protocol` and `reply-by` are load-bearing for termination and pattern-dispatch and the seed omits them from the envelope spec.
- **A3. The content language.** FIPA separates the *performative* (envelope) from the *content language + ontology* (payload). PD has no content-language story — the body is "string|json". A completionist L1 declares: what is the **shared ontology** an `inform` is asserting *about*? (file claims, roadmap items, commitments, symbols.) This is where L1 touches the olog/ontology-service idea.
- **A4. Tolerant decoding / wire evolution.** Untyped legacy bodies degrade to `inform`/Signals (seed has this). *Missing:* a versioning *negotiation* (what happens when an agent speaks envelope v2 to a v1 daemon) and a **conformance suite** (an agent that emits a malformed performative must be told, not silently dropped — the loud-fail discipline of ADR-0045 applied to the wire).

### B. The protocol layer — interaction patterns bound to PD operations
The seed binds seven patterns (contract-net, supervisor-worker, critique-refine, debate+judge, blackboard, fan-out/fan-in, request-response) to PD operations, each with a stop condition. The completion:
- **B1. Each pattern is a finite-state machine, not a name.** A protocol = {roles, legal performative transitions, terminal states, timeouts, exception edges}. The seed names patterns but does not give their FSMs. Contract-Net alone has: announce → (bid | refuse | timeout) → award → (inform-result | failure) → done — *and* the un-awarded-bidder cancellation edge, and the **re-announce-on-no-bid** edge. These are the FIPA interaction-protocol specs (FIPA-00029/00030) and PD must pick a subset and own its terminal states.
- **B2. Protocol composition.** Real work *nests* protocols: a Contract-Net award spawns a supervisor-worker sortie that internally runs critique-refine. L1 must define how a `conversationId` tree composes (parent/child conversations) so the Attention Queue and the digest can roll a nested dialogue up to one line and zoom back down. **The seed treats patterns as flat; they are a tree.**
- **B3. Pattern *selection*.** Who picks contract-net vs. supervisor-worker? The seed says "task-relationship type selects the protocol" (C3) but never gives the selection function. This is a real decision procedure L1 owns.
- **B4. Cancellation & compensation semantics.** When a protocol branch is cancelled mid-flight, what un-does? A file claim released, a port freed, a commitment abandoned, a half-written PR... This is the **Saga** problem (Garcia-Molina & Salem 1987) at the coordination layer — a cancelled `cfp` that already awarded needs a compensating action. The seed has `cancel` as a performative but **no compensation model**.

### C. The obligation layer — commitments enriched by GPGP/TÆMS
- **C1.** Commitment type `C(DL(T,q,t))` (deadline) vs `C(Do(T,q))` (best-effort) — seed has this.
- **C2.** Negotiability index (0–1), renegotiation triggers, lifecycle (pending/active/satisfied/broken) — seed has this. *Note:* the shipped `commitments.ts` lifecycle is `open/done/abandoned/superseded`, **not** the GPGP `pending/active/satisfied/broken` — a vocabulary seam the paper must reconcile (ADR-0045 honesty key).
- **C3.** Task-relationship types (enables / facilitates / hinders / redundant) + power factor — seed has this. *Missing:* TÆMS has a richer relationship set (`enables`, `facilitates`, `hinders`, `bounded`, `subtask`, `overlaps`) and **quality-accumulation functions** (min/max/sum/and/or over subtask qualities). The seed cites GPGP but takes only the headline; the **q-accumulation function is the thing that actually lets the supervisor compute "is this branch done well enough,"** which the seed leaves out.
- **C4. Commitment *to whom*.** GPGP commitments are *social* — a promise from A to B. The shipped commitment binds an obligation to *one* actor against a daemon clock; it does not model the **counterparty** or **mutual/conditional commitments** ("I'll do X *if* you do Y"). Mutual commitment is the bridge to L3 escrow and the seed never names it.
- **C5. Decommitment penalty.** Sandholm's leveled-commitment contracts: an agent may break a commitment by paying a penalty. This makes commitments *rational to adopt under uncertainty* — without a decommitment cost, a risk-averse agent never commits. The seed's "negotiability" is the soft version; the **priced** version is the L1→L3 hinge.

### D. The norm layer — deontic binding + termination
- **D1.** Prohibition→Arbiter (regimentation), Obligation→commitment (enforcement), Permission→capability — seed has this, grounded in Jones & Sergot 1993 and ADR-0045.
- **D2.** Termination on quiescence / TTL / Arbiter veto / HiTL threshold — seed has this. *Missing:* **distributed quiescence detection is non-trivial** — "no pending commitments in the branch" is a global predicate over a distributed conversation tree, and detecting it correctly is the Dijkstra-Scholten / Chandy-Lamport termination-detection problem. The seed asserts quiescence as if it were a local check; it is a **distributed snapshot**.
- **D3. Contrary-to-duty obligations.** What is the *secondary* obligation when a *primary* one is violated? (You should not break the build; if you do, you must revert.) Standard deontic logic (Chisholm's paradox) — and PD's "if you breach, you owe a salvage note" is exactly a CTD structure that the seed does not formalize.
- **D4. Permission as the default-deny boundary.** The seed maps permission→capability but does not state the **closure rule**: is L1 default-permit (everything not forbidden is allowed) or default-deny (everything not permitted is forbidden)? This is *the* architectural choice for a safe agent OS and it must be stated. (The Arbiter jail — phase below — implies default-deny on *tools*.)

### E. The enforcement substrate — the Arbiter jail (the missing safety arm)
ADR-0048 promotes "Jails / custom shell" to first-class L1 safety, but **ADR-0047 barely mentions it.** This is the largest seed gap. A completionist L1 must specify:
- **E1. Tool-allowlist per agent** — a deontic *permission set* materialized as a capability list the agent's shell enforces.
- **E2. Scoped filesystem** — an agent corralled to a worktree / path subtree (the project's own hard rule: agents that write get isolation).
- **E3. The corral mechanism** — is it a wrapper shell, a seccomp/sandbox-exec profile, a PROXY over tool calls? The enforcement *teeth* of every deontic prohibition live here, and without it D1's "prohibition→Arbiter" is advisory.
- **E4. Capability attenuation across delegation** — when A delegates to B, B's capability set must be ⊆ A's (no privilege escalation by delegation). This ties E to the delegation chain (F) and to the anchor-protocol's attenuation proofs.

### F. The provenance layer — delegation chains (two distinct meanings, conflated)
- **F1. Cryptographic delegation chain** (BUILT, `lib/delegation-chain.ts`): Ed25519 hop-binding, nonce-freshness, anti-replay/anti-splice — this proves *who authorized whom*.
- **F2. Coordination delegation chain** (DESIGNED, ADR-0047): loop detection, block-upward-by-default, terminate-on-repeated-task-shape — this prevents *ping-pong*.
- **The gap:** these are the *same field name* meaning *two different things*. F1 is a security artifact (from the anchor protocol / Paper 2); F2 is a liveness/termination artifact (Paper 1/L1). A completionist L1 states their relationship: **the coordination chain (F2) is carried inside the cryptographic chain (F1)** — loop-detection runs over a chain whose authenticity F1 guarantees. The seed uses "delegationChain" for both without noticing they are different objects.
- **F3. Context-fidelity across hops.** Seed: "for critical work, pass the original source bundle, not a summary" (anti context-degradation cascade). *Missing:* the **fidelity policy** — when is a summary acceptable vs. when must the source travel? This is the *legibility-with-zoom* principle (ADR-0048) applied to delegation: a hop that flattens is exactly Scott's over-legibility, *inside the protocol*.

### G. The discovery layer — who can I even talk to? (the read-poverty disease, at L1)
ADR-0048 promotes discovery to first-class but files it under L2. **Half of it is L1:** a performative needs an *addressee*, and an addressee needs a directory.
- **G1. `pd whois`** — capability/role lookup before you DM/claim/award (the seed of contract-net candidate selection).
- **G2. Yellow-pages / white-pages** — FIPA's Directory Facilitator (DF, capability lookup) and Agent Management System (AMS, identity lookup). A Contract-Net `cfp` is broadcast *to candidates*, and candidate-selection **is** a DF query. The seed's contract-net section assumes the candidate set exists; G supplies it.
- **G3. Liveness/presence** — an addressee must be *reachable now*. The seed's termination assumes you can tell a dead counterparty from a slow one — that requires a presence/heartbeat substrate (L0 provides; L1 must define the **suspicion** semantics: when is silence a `failure`?).

### H. The conversation-as-record layer — the L1↔L2 seam
- **H1. The conversation transcript** is the raw artifact the L2 digest indexes. Every performative is an append-only, content-addressed record. (`lib/transcript-store.ts` exists — BUILT-WEAK.)
- **H2. The roll-up contract.** L2's "legibility-with-zoom" needs L1 to emit conversations as a **zoomable tree**: one line ("Contract-Net for auth-refactor: awarded to claude-cli, 1 critique round, merged") that expands to every performative. The seed says the viz renders performatives but **never specifies the summarization contract L1 owes L2** — what a conversation's one-line digest *is*, and how zoom reaches the source. This is the single most important consistency obligation in the whole stack and the seed leaves it implicit.

---

## 2. Gaps the seeds missed (concrete)

1. **Felicity / sincerity conditions.** ADR-0047 lists performatives but not their preconditions. A `propose` from an agent that has already `agree`d elsewhere is incoherent; an `inform` asserting a false world-state is the *lie* ADR-0045 exists to catch. L1 must define each act's preconditions and what the daemon records (rational effect) vs. what the agent intends (perlocution) — the gap between them is the home of dishonesty.
2. **Protocol FSMs and their exception edges.** Patterns are named, not specified. No no-bid re-announce, no losing-bidder cancel, no critique-round budget exhaustion edge. "The system has hope, not termination logic" is the named failure — and naming a pattern without its terminal+exception states *is that failure*.
3. **Protocol composition (nesting).** Real conversations are trees of protocols sharing a `conversationId` lineage. The seed treats them as flat. Without nesting semantics the Attention Queue cannot roll up a sortie-of-a-contract-net.
4. **The Arbiter jail (E entirely).** ADR-0048 makes it first-class L1 safety; ADR-0047 omits it. Tool-allowlist, scoped FS, corral mechanism, capability attenuation across delegation — all absent from the seed yet load-bearing for "prohibition→Arbiter" to have teeth.
5. **Two-meanings-of-delegation-chain.** F1 (crypto, BUILT) vs F2 (loop-detection, DESIGNED) share a name and are different objects. The seed conflates them.
6. **Distributed quiescence detection.** "No pending commitments in the branch" is a global snapshot predicate (Chandy-Lamport / Dijkstra-Scholten), not the local check the seed implies.
7. **Compensation / Saga semantics on cancel.** `cancel` exists as a performative; the *undo* it must trigger (release claim, free port, abandon commitment, revert WIP) is unspecified.
8. **Mutual / conditional commitments + decommitment penalty.** GPGP commitments are social (A-to-B); shipped commitments are solo-against-clock. Conditional commitment ("X if you do Y") and priced decommitment (Sandholm) are the hinge to L3 escrow and are absent.
9. **q-accumulation functions.** The seed cites TÆMS but skips the quality-accumulation function (min/max/sum/and/or) that lets a supervisor decide "branch done well enough." That function *is* the supervisor's completion test.
10. **Directory / yellow-pages (G).** Contract-Net's candidate set is assumed, never sourced. FIPA's DF/AMS is the missing addressing layer; `pd whois` is the seed but it is L1, not purely L2.
11. **Contrary-to-duty obligations.** The "if you breach, you owe a salvage note" structure is a CTD; the seed has no secondary-obligation model.
12. **The default-deny closure rule.** Is L1 permit-by-default or deny-by-default? Unstated, and it is *the* safety axiom.
13. **Backpressure / flow control.** A `cfp` fan-out to 50 backends, or a supervisor flooded by worker `inform`s, is the **supervisor-bottleneck** failure the seed names but does not *mechanize*. "Once an hour not once a minute" (ADR-0046) is a *rate-limit on a performative class* — a real L1 mechanism (e.g., `inform` coalescing, distress preemption) that the seed gestures at without specifying.
14. **The honesty wire-contract.** ADR-0045's loud-fail applies to the protocol: a malformed performative, an unanswered `request` past `reply-by`, a counterparty gone silent — each must produce a *typed, visible* signal, not a silent drop. The seed has tolerant decoding (degrade to `inform`) but no loud-fail on protocol violation.

---

## 3. Open problems (→ starred exercises in the paper)

1. **★ Distributed quiescence under partial failure.** Detect "this conversation tree has terminated" when an agent may have crashed mid-commitment, without a global clock, with bounded message delay. (Termination detection meets FLP: Fischer-Lynch-Paterson 1985 — no deterministic consensus under one crash + async — so quiescence detection must be *eventually-correct with a failure detector*, not perfect.)
2. **★ Loop detection that distinguishes legitimate recursion from ping-pong.** "Terminate when a task-shape repeats in a branch" over-triggers on genuinely recursive work (refactor → test → refactor) and under-triggers on semantically-identical-but-syntactically-different re-delegation. What is the right *task-shape equivalence relation*? (Embeddings? structural hash? — and note the project's NO-KEYWORD-NLP rule forbids the naive substring approach.)
3. **★ Incentive-compatible decommitment pricing.** What penalty makes commitments *rational to adopt* yet *not cheap to break*? (Sandholm leveled-commitment; ties to L3 bond ledger — the L1 penalty and the L3 bond must be the same currency.)
4. **★ The fidelity/zoom trade-off in delegation.** When may a hop summarize vs. must it pass the source bundle? Quantify the context-degradation cascade: how many lossy hops before the original intent is unrecoverable? (This is Scott's over-legibility *as a measurable decay rate*.)
5. **★ Protocol selection as a decision procedure.** Given a task with TÆMS relationships, *derive* the protocol (contract-net vs supervisor-worker vs debate+judge). Is this a lookup table, a learned policy, or an operator default? (Cannot be a keyword classifier — must be structural.)
6. **★ Backpressure that preserves distress preemption.** Coalesce `inform` floods and rate-limit `request`s *without ever* delaying an `escalate`/`distress`. A priority-inversion-free scheduling problem on the performative stream.
7. **★ Sybil-resistant Contract-Net.** A backend that bids on everything (or spawns fake bidders) corrupts award. Without L3 reputation/identity (ADR-0040, unbuilt), what *local* defense does L1 have? (Bond-to-bid is the seed answer; is it enough single-player?)
8. **★ Capability attenuation soundness across delegation + protocol nesting.** Prove that no composition of delegate + spawn-sub-protocol can produce a capability the root lacked. (Connects to anchor-protocol attenuation proofs — is the *coordination* attenuation as sound as the *crypto* one?)
9. **★ Conversation digest faithfulness.** Define and *verify* that a one-line conversation digest is a lossless *index* (zoomable to truth) and never a lossy *replacement*. What is the invariant, and how does ADR-0045's attestation check it? (This is the legibility principle made a checkable L1↔L2 invariant.)

---

## 4. Adjacency contract

### What L1 ASSUMES from L0 (the daemon / kernel)
- **A durable, ordered, at-least-once message bus** (`tube`, BUILT) with channel pub/sub and a versioned envelope slot — L1 layers the performative *into* this envelope.
- **Stigmergic shared state with per-kind decay + TTL** (`pheromone`, BUILT) — L1's blackboard pattern *is* pheromones; the decay is what prevents blackboard-rot (so L1 owes L0 nothing new here — it *consumes* the decay guarantee).
- **Durable, daemon-clocked commitments with a breach monitor** (`commitments`, BUILT) — L1 *enriches* these (GPGP fields) but assumes L0 owns the deadline (Law 1: agent picks work, daemon picks deadline) and runs the monitor.
- **A regimentation monitor** (`arbiter`, BUILT) that can make a coordination state physically unreachable — L1 binds *prohibitions* to it.
- **Non-forgeable actor identity** (ADR-0040, **DESIGNED — the highest-leverage unbuilt keystone**) — L1's `sender`/`receiver`, delegation hops, and the felicity conditions all *assume* an identity that cannot be spoofed. **This is L1's single most load-bearing assumption from below, and it is not yet built.** Every L1 honesty claim is conditional on it.
- **Append-only notes, actor inboxes, transcript store** (BUILT / BUILT-WEAK) — L1's record-of-conversation.
- **A presence/heartbeat substrate** (sessions, BUILT) — L1's reachability/suspicion semantics read from it.
- **Cryptographic delegation primitives** (`delegation-chain.ts`, BUILT) — L1's coordination chain rides inside L0's crypto chain.

### What L1 PROVIDES to L2 (legibility / the operator)
- **A typed, addressable conversation stream**: every coordination event is a performative with intent + ownership + counterparty + conversation lineage — so the Attention Queue's Distress/Requests/Signals lanes are *the performative taxonomy rendered*, not a hand-built classifier.
- **Conversations as a zoomable tree**: nested `conversationId` lineage with a one-line digest contract + a zoom path to every constituent performative. **This is the L1→L2 legibility hand-off and the consistency spine of the whole volume.**
- **Explicit termination signals**: L2 can render "this is done / blocked / awaiting-human" because L1 emits quiescence / TTL-expiry / Arbiter-veto / HiTL-threshold as typed terminal acts — not inferred from silence.
- **Obligation state for the roadmap**: commitment lifecycle + breach signals feed L2's "roadmap-as-truth" and the completionist obligation.
- **A loud-fail protocol surface**: malformed performatives, unanswered `request`s, gone-silent counterparties surface as *typed visible signals* (ADR-0045) — so L2's digest never hides a protocol failure behind a quiet green.
- **The HiTL escalation primitive**: `escalate`/`distress` is the typed act L2's human-gate consumes; L1 guarantees it preempts all other performative flow (no distress starvation).

### What L1 PROVIDES toward L3 (economy / federation — the bridge)
- **Contract-Net dispatch** is the *local* skeleton of the L3 market: `cfp`→bid→award becomes the auction once bids carry bonds (ADR-0014) and bidders carry reputation (ADR-0049).
- **Mutual/conditional commitments + decommitment penalty** are the *local* skeleton of L3 escrow: the same currency, the same breach monitor, scoped first to one operator then across federation.
- **Capability attenuation across delegation** is the *local* skeleton of cross-harbor trust: B's caps ⊆ A's locally becomes Alice's-fleet's caps ⊆ what-you-granted across the boundary.

---

## 5. Prior art to cite

| Work | Year | One-line relevance |
|---|---|---|
| **Searle, *Speech Acts*** | 1969 | The philosophical root of performatives — felicity conditions; why a `request` can be *infelicitous*, not just false. |
| **FIPA ACL + Communicative Act Library (FIPA-00037)** | 2002 | The standard performative vocabulary PD narrows; the rational-effect vs. feasibility-precondition split. |
| **FIPA Interaction Protocol Library (FIPA-00025/00029/00030)** | 2002 | The *FSMs* for Contract-Net, Request, Propose — PD's protocol patterns are subsets of these. |
| **FIPA Agent Management (FIPA-00023) — AMS/DF** | 2002 | White-pages (identity) + yellow-pages (capability) — grounds the discovery/`pd whois` layer (gap G). |
| **Smith, Contract Net Protocol** | 1980 | Announce→bid→award→result — the canonical decentralized dispatch; PD's market dispatch skeleton. |
| **Decker & Lesser, GPGP / TÆMS** | 1995 | Typed commitments (`C(DL)`/`C(Do)`), task relationships, **q-accumulation functions** (the gap-9 piece), quiescence-as-termination. |
| **Jones & Sergot, deontic logic in computer systems** | 1993 | The regimentation-vs-enforcement split — PD's Arbiter (prohibition) vs commitment-monitor (obligation). |
| **Sandholm & Lesser, leveled-commitment contracts** | 2001 | Priced decommitment — makes commitments rational to adopt; the L1→L3 escrow hinge (gap 8 / open-problem 3). |
| **Chisholm, contrary-to-duty paradox** | 1963 | Secondary obligations on violation — formalizes "if you breach, you owe a salvage note" (gap 11). |
| **Castelfranchi, *Commitments: From Individual Intentions to Groups*** | 1995 | *Social* commitment (A-to-B, witnessed) — the counterparty model shipped commitments lack (C4). |
| **Cohen & Levesque, *Intention is Choice with Commitment*** | 1990 | Persistent goals + the rational basis for *why an agent honors a commitment* — under-pins the BDI binding. |
| **Rao & Georgeff, BDI (from theory to practice)** | 1995 | Belief-Desire-Intention — obligation-as-adopted-desire, prohibition-as-negative-desire (ADR-0047's deontic grounding). |
| **Dijkstra & Scholten, termination detection in diffusing computations** | 1980 | Distributed quiescence detection — the real algorithm behind "no pending commitments in the branch" (gap 6, open-problem 1). |
| **Chandy & Lamport, distributed snapshots** | 1985 | Consistent global-state capture — the other half of quiescence under concurrency. |
| **Fischer, Lynch, Paterson (FLP impossibility)** | 1985 | No deterministic async consensus under one crash — bounds what termination/quiescence can *guarantee* (open-problem 1). |
| **Garcia-Molina & Salem, Sagas** | 1987 | Compensating transactions — the undo model for cancelled protocol branches (gap 7). |
| **Hoare, CSP** | 1978 | Communicating sequential processes — the formal lineage for typed channels + the protocol-as-FSM view. |
| **Wooldridge, *An Introduction to MultiAgent Systems*** | 2009 | The textbook synthesis (ACL, Contract-Net, BDI, coordination failure modes) — the survey anchor. |
| **Bellifemine et al., JADE/FIPA** | 2007 | The reference *implementation* of FIPA — the "we want the vocabulary, not the middleware" foil (Considered Option B). |

---

## 6. Honest state (BUILT / BUILT-WEAK / DESIGNED / VISION — checked against shipped code)

| Claim / mechanism | State | Evidence |
|---|---|---|
| Tube pub/sub message bus with versioned envelope (`v`, `inReplyTo`, `kind`) | **BUILT** | `lib/tube.ts` (535 LOC); envelope `{ v:1, kind, body, inReplyTo }`. |
| **Typed performative on the envelope** (`performative`, `conversationId`, `delegationChain`) | **DESIGNED** | `grep` of `lib/tube.ts`: envelope has `inReplyTo` only — **no** `performative`/`conversationId`/`delegationChain`. ADR-0047 phase 0 unbuilt. |
| Performative → Attention-Queue lane → living-harbor visual mapping | **DESIGNED** | Table in ADR-0047; viz is "Potemkin until the comms carry real intent" (ADR-0047 own words). |
| Pheromone blackboard with per-kind decay + TTL (anti blackboard-rot) | **BUILT** | `lib/pheromone.ts` (245 LOC). |
| Durable commitments, daemon-owned deadline, breach monitor | **BUILT** | `lib/commitments.ts` (385 LOC); states `open/done/abandoned/superseded`; Law 1 deadline policy; obligation monitor. |
| **GPGP-enriched commitments** (`C(DL)`/`C(Do)`, negotiability, power factor, relationship type, q-accumulation, GPGP lifecycle names) | **DESIGNED** | None of these fields exist in `commitments.ts`; lifecycle vocabulary differs from GPGP. ADR-0047 phase 3 unbuilt. |
| Mutual / conditional commitments + decommitment penalty | **VISION** | No counterparty or conditional-commitment model in code; named here as the L3 hinge. |
| Arbiter regimentation (forbidden coordination states unreachable) | **BUILT** | `lib/arbiter.ts` (760 LOC); ADR-0045. |
| Deontic binding (prohibition→Arbiter, obligation→commitment, permission→capability) | **BUILT-WEAK** | Arbiter + commitments exist and are *invoked* as regimentation/enforcement (ADR-0045), but the explicit deontic *binding layer* (ADR-0047 phase 4) is not a unified module. |
| **Arbiter jail / custom shell** (tool-allowlist, scoped FS, capability attenuation) | **DESIGNED** | Promoted to first-class L1 safety in ADR-0048; no jail module in `lib/`; the enforcement *teeth* are advisory today. |
| Cryptographic delegation chain (hop-bind, nonce-freshness, anti-replay/splice) | **BUILT** | `lib/delegation-chain.ts`; backed by ProVerif `proofs/anchor/delegation/chain-replay.pv`. |
| **Coordination delegation chain** (loop detection, block-upward, terminate-on-repeated-task-shape) | **DESIGNED** | ADR-0047 phase 2; the shipped chain is the *crypto* object, not the *loop-detection* object — distinct meanings (gap 5). |
| Contract-Net dispatch (cfp→bid→award→result) | **DESIGNED** | `grep` for contract-net/cfp/bid across `lib/ cli/ routes/`: **zero hits.** `pd spawn`/`pd sortie` exist but dispatch is not auction-shaped. |
| Tube→spawner router (drive the fleet over tube, fail-closed) | **BUILT-WEAK** | `lib/tube-spawner-router.ts` (ADR-shipped #225) — routes tube to spawner but does not yet carry typed performatives. |
| Termination on quiescence / TTL / Arbiter-veto / HiTL | **DESIGNED** | Commitment TTL + Arbiter veto exist as primitives; *per-dialogue distributed quiescence detection* does not. ADR-0047 phase 4 unbuilt. |
| Protocol patterns as specified FSMs (terminal + exception edges) | **DESIGNED** | Named in ADR-0047; no FSM registry in code. ADR-0047 phase 1 unbuilt. |
| Discovery / `pd whois` (DF/AMS yellow+white pages) | **DESIGNED** | Named as "seed" in ADR-0048; not shipped. |
| Conversation transcript store (the L2-digest source) | **BUILT-WEAK** | `lib/transcript-store.ts` exists; not yet wired to a performative stream or a zoom contract. |
| Conversation-as-zoomable-tree digest contract (L1→L2) | **DESIGNED** | The most important consistency obligation; specified here, unbuilt. |
| Loud-fail on protocol violation (malformed performative, unanswered request) | **DESIGNED** | Tolerant decode (degrade-to-`inform`) is specified; *loud* failure on violation is not — gap 14. |
| Non-forgeable actor identity (the assumption L1 rests on) | **DESIGNED** | ADR-0040; named in the volume nomenclature key as "the highest-leverage unbuilt keystone." **Every L1 honesty claim is conditional on this.** |

**One-line honest summary for the paper header:** *L1's substrate is BUILT (tube, pheromones, commitments, Arbiter, crypto-delegation); its semantics are DESIGNED (typed performatives, protocol FSMs, GPGP enrichment, coordination-loop-detection, distributed termination, the jail, discovery); its market-facing pieces (mutual/priced commitments) are VISION. The layer is real where it touches the kernel and a specification everywhere it touches the agents — and all of it is conditional on the unbuilt non-forgeable identity (ADR-0040) below it.*

---

Files referenced (absolute):
- North Star: `/Users/erichowens/coding/tmp/pd-papers/docs/adr/0048-what-port-daddy-is.md`
- L1 protocol: `/Users/erichowens/coding/tmp/pd-papers/docs/adr/0047-conversation-protocol.md`
- Honest-label discipline: `/Users/erichowens/coding/tmp/pd-papers/docs/adr/0045-loud-fail-invariants-and-honest-attestation.md`
- Volume plan: `/Users/erichowens/coding/tmp/pd-papers/docs/research/north-star/00-HARBOR-VOLUME-ARCHITECTURE.md`
- Shipped L1 code grounding the honest state: `/Users/erichowens/coding/tmp/pd-papers/lib/{tube.ts,pheromone.ts,commitments.ts,arbiter.ts,delegation-chain.ts,tube-spawner-router.ts,transcript-store.ts}`",