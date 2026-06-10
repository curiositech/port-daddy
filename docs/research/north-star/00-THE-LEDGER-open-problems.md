# The Ledger — the single authoritative list of what to prove, figure out, and build

> Every obligation the Harbor Library's algorithms raise, in one place. Until now
> these were scattered across the stitch report's completeness verdict, each
> dossier's open-problems, each paper's starred exercises, and the roadmap DAG
> (which tracked *implementation* only). This is the union.
>
> **Status key:** `PROVEN` (machine-checked) · `ARGUED` (pen-paper/TLA⁺, not
> mechanized) · `CONJECTURED` (stated, believed, unproven) · `OPEN` (genuinely
> unsolved) · `BUILT` / `PARTIAL` / `SPECIFIED` / `UNBUILT`.
> **Next step:** these rows should be promoted into the PD database as a
> first-class `obligation` kind (stable IDs + roadmap FKs), per the triage-taxonomy
> rule — markdown is the staging area, the DB is the home.

---

## A. Proof obligations (formal — what must be *proven*)

| ID | Obligation | Algorithm / mechanism | Paper | Status | Method |
|----|------------|------------------------|-------|--------|--------|
| **PRV-1** | Single-agent identity + capability proof, no trusted third party | the auth-chain (Anchor) | II/IV | **PROVEN** | ProVerif |
| **PRV-2** | Capability attenuation is monotone (sound `is_subset`, non-vacuous) | auth-chain attenuation | II/IV | **PROVEN** | ProVerif (closed the vacuous proof) |
| **PRV-3** | Immunity to algorithm-confusion, impersonation, timing side-channels | auth-chain | II | **PROVEN** | ProVerif + Kani |
| **PRV-4** | E2E secrecy + publisher auth past a malicious relay | relay envelope | IV | **PROVEN** | ProVerif |
| **PRV-5** | Single-writer kernel is serializable / linearizable | the kernel | II | **ARGUED** | needs a stated formal theorem |
| **PRV-6** | Cross-runtime soundness (bun vs node compute identical truth) | dual-runtime substrate | II | **OPEN** | differential test harness, as a CI gate |
| **PRV-7** | Durability by fault class: process-crash-durable ✔, power-loss NOT guaranteed under `synchronous=NORMAL` | WAL substrate | II | **ARGUED** | must split the claim (Gray–Reuter) |
| **PRV-8** | Non-forgeable identity is *necessary* for any sanction-respecting reputation | identity → reputation | III | **CONJECTURED** | upgrade Property → Theorem w/ proof |
| **PRV-9** | Whitewashing-cost lower bound (newcomer policy) | reputation w/ respawn | III | **OPEN** | bound to prove |
| **PRV-10** | Grading-oracle incentive-compatibility; rate-the-raters recursion terminates | the judge market | III/IV | **CONJECTURED** (Conj. 11.1) | strategy-proof oracle OR bond-and-slash + contraction proof |
| **PRV-11** | Conservation composes upward as a **functor** (single unit-of-account) | bond ledger federation | IV | **ARGUED** | proven for single-unit; mechanize |
| **PRV-12** | Multi-currency federation is at most a **lax functor**, φ-bounded; coherence | cross-harbor settlement | IV | **OPEN** | unify w/ PRV-13 as one obstruction |
| **PRV-13** | The double-spend / equivocation race = non-vanishing of H¹ of the gluing (sheaf-cohomology obstruction) | cross-harbor settlement | IV | **OPEN** | the honest form of "is trustless cross-harbor settlement possible" (cf. Herlihy–Liskov–Shrira) |
| **PRV-14** | Myerson–Satterthwaite corner: strict conservation ⇒ sacrifice efficiency *or* IR — name which | the market mechanism | IV | **ARGUED** | efficiency named as sacrificed; formalize |
| **PRV-15** | Federation safety/liveness (revocation gossip converges within bound) | revocation gossip | IV | **ARGUED** | TLA⁺; not yet mechanized to Anchor's level |

## B. Open research questions (what to *figure out / expand*)

| ID | Question | Paper |
|----|----------|-------|
| **RQ-1** | **Cross-operator attestation** — bind `actor_id` keys across harbors you don't own, without a global PKI (the unbuilt keystone the whole L3 half rests on; ADR-0040 defends only *intra-fleet*) | III→IV |
| **RQ-2** | Forced-zoom sampling rate — how often must the operator zoom, as a function of agent reputation × action stakes? | I |
| **RQ-3** | Compaction-quality scalar — what must a digest *retain* to be a faithful, zoomable index (not over-flattening)? | I |
| **RQ-4** | Price of anarchy when reputation is itself for sale | IV |
| **RQ-5** | The unit of reputation — per-actor vs per-(actor, surface): accuracy vs cold-start sparsity | III |
| **RQ-6** | A stated deontic logic for the protocol (input/output logic; contrary-to-duty; O/F/P conflict resolution) | I (L1) |
| **RQ-7** | Operator-attention objective re-spined on Signal Detection Theory (a miss-cost term; resist Goodhart) | I |
| **RQ-8** | The single-writer throughput ceiling — quantify it; backpressure/fairness under contention | II |
| **RQ-9** | What is *recoverable* vs fundamentally *lost* when an LLM agent dies mid-thought | III |
| **RQ-10** | Reputation bounded-memory as a *design parameter* (Liu–Skrzypacz bubbles) vs "never decays" | III |

## C. Implementation tasks (what to *build* — these are the roadmap DAG)

The L0→L3 build is already seeded in `roadmap_items` (ADR-0048 phases 0–8, ADR-0047
phases 0–5, ADR-0050 phases 0–6). The algorithm-level builds below either map to a
seeded phase or need a new one.

| ID | Build | Maps to roadmap slug | Status |
|----|-------|----------------------|--------|
| **IMP-1** | Checkpoint-with-teeth — content-addressed snapshot of {working-tree diff + open claims + commitment set + last-N turns} (the third continuity organ) | adr-0048-phase-5-L3-identity-continuity | **UNBUILT** (resurrection passes notes only) |
| **IMP-2** | The envelope substrate — idempotency key + dedup window + causal order (happened-before) + a named failure-detector class | adr-0047-phase-0-performative-envelope | **PARTIAL** (has inReplyTo/conversationId) |
| **IMP-3** | The outcome ledger — witnessed (agent, task, skill, backend) → (cost, multi-dim quality) | adr-0048-phase-5 → -phase-6 | **SPECIFIED** (ADR-0049) |
| **IMP-4** | Skill→agent helpfulness attribution (esp. when SKILL.md/refs/scripts loaded into context) | adr-0048-phase-6-L3-reputation | **SPECIFIED** |
| **IMP-5** | The neutral-judge market (multi-dim quality, hired via bonded protocols, bond-and-slash) | adr-0048-phase-6-L3-reputation | **SPECIFIED** (ADR-0049) |
| **IMP-6** | Cross-operator attestation mechanism (RQ-1 made real) | *needs new slug: adr-0048-phase-7 dependency* | **UNBUILT** |
| **IMP-7** | The Coast Guard — secret broker / dollar-metered egress / OS confinement / signed receipt | adr-0050-phase-0..3 | **PROTOTYPE** (pd-cutter) |
| **IMP-8** | Consent as a scoped/revocable primitive + inalienable operator override | *needs new slug under adr-0048-phase-2* | **UNBUILT** |
| **IMP-9** | OS-enforced (not advisory) file/region isolation — Landlock/Seatbelt/seccomp | adr-0050-phase-4-real-isolation | **UNBUILT** |
| **IMP-10** | budget-guard self-reported spend → byte/usage-metered hard cap | adr-0050-phase-2-dollar-metering | **UNBUILT** (self-report today) |

---

## The five that gate everything (from the stitch P0 + the keystone)

1. **RQ-1 / IMP-6 — cross-operator attestation.** Gates the entire market thesis (Paper IV). Highest leverage.
2. **IMP-1 — checkpoint-with-teeth.** The literal foundation of L3 reputation; until it exists the economy is built on sand.
3. **PRV-10 — the grading oracle is IC.** A hole in the *core* folk-theorem, not a footnote.
4. **IMP-2 — the envelope substrate.** Without it the performative taxonomy is unsound under the at-least-once transport.
5. **PRV-12/13 — the conservation functor's lax coherence.** The economy's central invariant, currently overclaimed.

*This Ledger is v1, compiled from the stitch report + dossiers. It must be enriched
from each paper's final §Gaps/starred-exercises after the revision pass, then
promoted into the PD database as the authoritative `obligation` registry.*
