# The Four Papers — the canonical structure of the volume

> Status: **canonical**. Supersedes `00-HARBOR-EDIFICE.md` (retires the
> "Floors × Beams" 4×4 grid and the 8-paper roster) and the older
> "four explain / three prove" + "Trilogy" framings. Grounded in ADR-0048
> (the L0→L3 stack) and reconciled against four independent audits: the full
> ADR set, the open-problems Ledger (`00-THE-LEDGER-open-problems.md`), the
> layer dossiers (`layers/`), and the actual proof artifacts under `proofs/`.

## 0. Why four, and why this cut

The volume splits **where a machine-checked equilibrium stops holding** — not
by editorial taste.

Truthful file-claim signaling is a Nash equilibrium of the repeated
coordination game **inside one operator's box** (observable history + persistent
identity + high δ). The threshold is mechanically established:
`proofs/economics/delta-threshold.z3` (δ\* ≈ 0.3425, Z3) and
`proofs/economics/claim_signaling.tla` (TLA⁺). Federation breaks persistent
identity (Sybil-reset drives δ→0); the cooperative equilibrium collapses; and
**economic enforcement must replace the guarantee that cooperation used to give
for free.**

That collapse is exactly the seam between Papers 1–3 (one operator) and
Paper 4 (many operators). **The partition is a theorem.** This sentence opens
the volume.

The four papers are one rising argument — the **trust radius widens** one ring
at a time, and each ring is load-bearing only because a proof underneath it
holds. The proofs do not live in a separate section; each sits inline, directly
under the claim it earns.

| # | Paper | Ring | One-sentence thesis |
|---|-------|------|---------------------|
| 1 | **The Kernel** | one machine | Coordinating many agents on one machine is a *serialization* problem, not an *agreement* problem: one writer beats consensus. |
| 2 | **The Legible Swarm** | one operator | The limit on a swarm is how much of it you can *see*; legibility is the product, and the operator who can see it is its final brake. |
| 3 | **From Spawn to Person** | one durable identity | Continuity, not capability, makes an agent accountable: the score is cheap, the substrate is the moat. |
| 4 | **The Harbor** | many operators | You sell the trust that makes a market of distrusting operators possible — *once* the cross-operator identity keystone ships. |

**Reading order is two walks over one structure** (the IA finding: one DAG, two
legal walks):
- **Front door / newcomer (wedge-first):** **2 → 1 → 3 → 4.** Lead with the
  wedge you actually sell (legibility), then reveal the kernel under it, then
  the durable identity, then the market.
- **Reviewer (foundation-up):** **1 → 2 → 3 → 4.** Each floor, then the proof
  that holds it.

Logical/dependency numbering below is foundation-up (1 = Kernel … 4 = Harbor).

---

## 1. The four papers

For each: the thesis, what it **absorbs** from today's roster, the **proof
inline**, the **safety slice** it carries, its **honesty constraints**, and the
**open problems it hands forward**.

### Paper 1 — The Kernel *(one machine, contained)*

**Thesis.** One writer beats consensus — and that same single decider is the
reference monitor that contains a *cooperative-but-careless* agent.

> **Thesis discipline (audit-forced):** this is a **coordination/legibility**
> claim, **not** a swarm-quality claim. The repo's own realism-check
> (`docs/research/2026-06-03-hive-mind-realism-check.md`) endorses single-writer
> authority but *debunks* "swarms beat frontier models." Do not let "one writer
> beats consensus" tip into "the swarm is therefore better."

**Absorbs:** the Single-Writer Kernel; the **`auth-chain`** crypto (the Anchor
delegation/attenuation proof); the L1 substrate (tube, pheromone, commitments,
typed envelope); the **machine-side** half of containment.

**Proof inline:**
- `proofs/anchor/delegation/chain-replay.pv` — `chain_accepted ⟹ chain_authorized` (▰ built · ProVerif)
- `proofs/anchor/token-verify/algconfusion.pv` — pinned-verifier authenticity (▰ built · ProVerif)
- serializable transactions / linearizable claims (▰ built — the formal payoff of single-writer)
- *Kani is bounded memory-safety / constant-time only — **do not** cite it for capability attenuation; ProVerif is the attenuation proof.*

**Safety slice (machine-side).** The reference monitor is **regimentation**
(the PK constraint + the fail-closed boot gate make forbidden states
unreachable), **not** the Arbiter — the Arbiter is a post-commit subscriber that
**detects-and-compensates** (Sagas), it does not prevent. Coast Guard
confine/meter/receipt (ADR-0050). The honest scope:
- **Contains:** a cooperative-but-careless agent (runaway spend, accidental exfil).
- **Does NOT contain:** a malicious **same-UID** agent (ADR-0017/0018/0050 — "no
  novel cryptography"; 12 logged unmitigated vulns; "verified but not
  bulletproof"). The spend cap is **1-of-7 dimensions enforced** and
  **self-reported** today; OS isolation is **unbuilt**. State this inline.

**Honesty (the per-claim table must show):** kernel/WAL ▰ built; envelope
monitor ▰ built; durability **split by fault class** — crash-durable ▰ built /
power-loss *not guaranteed* under `synchronous=NORMAL`; Anchor float-plan
▱ designed (the proof is on-paper, the ceremony unbuilt); same-UID containment
· open.

**Nomenclature:** **`auth-chain`** (crypto, Ed25519 hop-bound) vs
**`delegation-trace`** (coordination loop-detection) — two objects, never
conflated. **Capability** (ability) ≠ **permission** (normative status). Ban
"physically unreachable" except for the PK-constraint/boot-gate states.

**Hands forward:** checkpoint-with-teeth (OP-4, co-owned with Paper 3);
agreement-attainability under lossy channels; the idempotency-key + causal-order
envelope the performative taxonomy needs.

### Paper 2 — The Legible Swarm *(one operator, in control)* — front-door lead

**Thesis.** Legibility is the product; the operator who can see the swarm is its
final safety brake. The triad is **Legibility + Authority + Consent** (the
operator is the *author*, Hobbes ch. 16 — not subject, not sovereign).

**Absorbs:** the Legible Swarm; the **human-side** half of containment
(HITL / force-zoom); the **read-poverty / discovery** material (`pd whois`,
the navigability half of the L2→L3 bridge); the **tokens / COGS / context-rot /
digest-with-zoom** material (the otherwise-homeless P1–P2 seam).

**Proof / evidence inline:** the read-surfaces are mostly ▰ built
(attention queue agent-side, briefing projection, attestation/honest-green,
episodic memory). The **operator model** is substantial **net-new design**:
attention as a **Signal-Detection** problem (asymmetric miss/false-alarm cost,
not throughput), costly-signal escalation, the **consent grant** primitive
(scope · stakes-ceiling · reversibility-class · ttl · revoked-by), and the
**completionist `done`** as a Fast/Slow verifier with a **refuse-to-route** gate
("I cannot verify this completion" → SKIP-loud → HITL).

**Safety slice (human-side):** the consent grant primitive (express, scoped,
revocable); the **inalienable operator override** (`pd halt` — no
daemon→operator bypass); force-zoom on P0 (legibility gate L7).

**Honesty:** legibility *principle* ratified + read-surfaces ▰ built; the
operator cockpit / TUI ▱ designed (phased); suggestibility ▱ designed;
force-zoom-on-P0 · open (vision). The "unified ranker" claim is **false as
stated** — `whois` maximizes *fit*, the attention queue maximizes
*regret-if-ignored*: shared candidate-generation + decay substrate, **distinct
scoring heads.**

**Nomenclature:** "digest-with-zoom" (the one law — every summary is a lens,
never a wall); "verifiable-zoom" (the target is the **artifact**, not the
chain-of-thought — Turpin 2023 on unfaithful traces); "legible sovereign";
"read-poverty"; "refuse-to-route".

**Hands forward:** the forced-zoom sampling rate p(r,s,v) under SDT (couples
agent reputation to operator decision quality — the bridge to Paper 3);
compaction/digest faithfulness.

### Paper 3 — From Spawn to Person *(one durable identity)*

**Thesis.** Continuity, not capability, makes an agent accountable. The
reputation *score* is cheap; the non-forgeable *substrate* it scores over is the
moat.

**Absorbs:** Spawn→Person; the **identity-binding** half of Anchor
(ADR-0040, identity-local); the **recovery proofs** — `proofs/bonded/federated/federated.pv`
(4-share account recovery) and `proofs/bonded/recovery/magic-link.pv` — **moved
here from the Harbor**, because they are identity/continuity proofs, not market
federation; the three continuity organs; the reputation substrate.

**Proof / evidence inline:**
- The **46 → 29 → 1 accountability audit** (`agent-accountability-*.md`): of 29
  stress-tested mechanisms, **exactly one survived unhardened** (the
  regimentation-vs-enforcement distinction). This is the hard data behind "no
  reputation without non-forgeable continuity" and the five laws. (▰ built · analysis)
- recovery secret-sharing (▰ built · ProVerif: `account_root` not
  attacker-derivable under 3-of-4 custodian compromise)
- reputation = **monotone in witnessed, un-revoked outcomes** over a tuned
  records-window (bounded below by Friedman–Resnick whitewashing defense, above
  by Liu–Skrzypacz bubble prevention) — **not** an "anti-revocation" property.

**Honesty:** notes/resurrection ▰ built; **checkpoint-with-teeth ▰ built ·
notes, not execution state** (the BUILT-WEAK case — glyph built, the weakness in
the verifier text); outcome ledger ▱ designed; ADR-0040 ▱ designed
(single-operator, explicitly "not a PKI"); **cross-operator identity
(ADR-0040b / ADR-0051) · open** — and this is the keystone Paper 4 waits on.

**The C7 canonical sentence (verbatim in all four papers):**
> *The economy rests on three continuity organs — memory (built), checkpoint
> (built-weak: notes, not state), and the outcome ledger (designed) — and
> reputation keys on the third; "resurrection with teeth" is its literal
> foundation.*

**Nomenclature:** "a person, not a spawn"; "outcome ledger, not memory stream";
"the three organs of continuity"; "the five laws"; "Sybil-reset / whitewashing
as the universal solvent". Reputation revocation = **propagating tombstone**:
full compensation for *bonds* (a monoid), **bounded** mitigation for
*reputation* (not a monoid — the Sagas type-mismatch); a spendable-poison window
≥ Δ(1 + ln m).

**Hands forward to Paper 4:** the cross-operator identity keystone
(ADR-0040b / ADR-0051) as the **named, blocking** dependency.

### Paper 4 — The Harbor *(many operators, a market)*

**Thesis.** You sell the **trust** that makes a market of distrusting operators
possible — *not* the settlement rail. "Hosted trust" (verified ledger + relay +
reputation) is the moat. **Conditioned:** the cross-operator market *will* work
**once** the non-forgeable cross-operator identity keystone (ADR-0040b/0051)
ships; until then it is correct in structure but cannot execute cross-machine.

**Absorbs:** the Harbor Economy; the Bonded Commons **conservation** proof; the
market + federation surface (events, **not** state); guilds / cross-harbor trust.

**Proof / evidence inline:**
- **Conservation** — `wallet + escrow + commons = supply` (▰ built · TLA⁺:
  `proofs/bonded/conservation` 1716 states, "no error found" + a 10k-trace
  property test). *This is the most rigorous artifact in the set — claim it
  proudly; do not under-claim the economy.*
- capability attenuation (▰ built · ProVerif).
- The **§8.4.4 Monte-Carlo trilogy** is the empirical backbone — and it is
  **conditional**, which the paper must state, not bury:
  - Pareto-dominance of competitive pricing holds in **86–95% of trials** —
    **only when** reputation noise σ_r ≤ 0.1 and there is no full cartel.
  - It **inverts** under winner's-curse (σ_r ≥ 0.3 → dominance → 0) and full
    cartel (principal pays *more* than static).
  - **Deposit-only Sybil deterrence fails at every level** (attack-profitable
    rate = 1.000): conservation ≠ Sybil-resistance; you need the composite
    (identity cost + reputation gating + per-class deposit).
  - (▰ built · simulation — *labelled as simulation, never as proof*.)

**Required net-new section — "Conditions & failure regimes."** Stating the
dominance thesis without its quantified breakpoints is the exact "sell a design
as a feature" failure ADR-0045's honesty contract forbids.

**Honesty / must-carry framing:**
- "**three-sided by design; two-sided until reputation ships**" (mandatory rider).
- **Conservation functor scope rider:** single-unit-of-account composes as a
  *conservative* functor (▰ built · proven); multi-currency is at most a *lax*
  functor bounded by φ, **coherence unproven** — never state "conservation
  composes upward" unqualified.
- **Grading-oracle IC is a named theorem/assumption in §0**, not a side-gap:
  machine-checkable grades are strategy-proof by construction; subjective axes
  are a bonded-judge sub-mechanism with rate-the-raters recursion bottoming out
  at a machine grade.
- **Myerson–Satterthwaite:** the conserving ledger fixes budget-balance + IC and
  therefore **sacrifices first-best efficiency** — a stated trade-off, not a hole.
- **Equivocation is detected, never prevented** (witness bond ≥ worst-case
  spendable during the detection window).
- **Never** call the relay "formally verified" — ProVerif covers agent↔daemon
  only; the relay extension is unbuilt; Float-Plan settlement is deferred and
  off the critical path.

**Honesty (table):** conservation + attenuation ▰ built · proven; marketplace /
settlement ▱ designed (intra-machine Phase 0 only); relay events-not-state v0
▱ designed (app unbuilt); **cross-operator attestation · open · BLOCKING.**

---

## 2. Cross-cutting requirements (all four papers)

1. **A per-claim mechanization-status table in every paper.** This is the
   honesty firewall the old "3 prove papers" provided — **moved inline as a
   column** instead of a separate paper. It reconciles with the locked 3-mark
   key as: glyph **▰ built · ▱ designed · · open**, plus **verifier text** that
   carries the method *and* any weakness — `▰ built · ProVerif`,
   `▰ built · TLA⁺`, `▰ built · Z3`, `▰ built · notes, not state` (the
   BUILT-WEAK case), `▰ built · simulation`, `▱ designed`, `· open`. There is no
   fourth glyph. Without this table, inlining proofs **launders** designed/argued
   claims under proven ones — the single failure all four audits flag.
2. **The C7 canonical sentence**, verbatim in all four (see Paper 3).
3. **The nomenclature register** (§1): `auth-chain`/`delegation-trace`,
   capability/permission, the conservation and three-sided riders, "monotone in
   un-revoked outcomes," ban on "physically unreachable" and "formally verified
   relay."
4. **The honesty contract (ADR-0045)** governs every claim:
   BUILT→`▰ built`, BUILT-WEAK→`▰ built · <weakness>`, DESIGNED→`▱ designed`,
   VISION/UNBUILT/OPEN→`· open`.

**Net-new writing inventory** (everything else is *move + edit*, not research):
(a) the machine-side containment section (P1); (b) the operator model — SDT
attention, consent primitive, completionist done-gate (P2); (c) the "conditions
& failure regimes" section (P4); (d) the folk-theorem justification of the
partition itself (front matter).

---

## 3. Migration map (every current artifact → destination · operation)

| Current artifact | → Paper | Operation |
|---|---|---|
| Legible Swarm (I) | 2 | keep · add operator-model · absorb discovery + tokens |
| Single-Writer Kernel (II) | 1 | keep · add machine-side containment |
| Anchor Protocol (V, proof) | 1 | **move inline** (auth-chain) |
| From Spawn to Person (III) | 3 | keep · sober title · add 46→29→1 audit |
| `federated.pv` + `magic-link.pv` (recovery) | 3 | **move from `bonded/`** (identity-recovery, not market) |
| Harbor Economy (IV) | 4 | keep · **condition** the thesis on ADR-0040b |
| Bonded Commons (VI, proof) | 4 | **move inline** (conservation + §8.4.4 sims) |
| Federated Harbor (VII, proof) | 4 | **split:** recovery→P3; federation/settlement stays **open** in P4 |
| tokens-compaction | 2 | absorb (P1–P2 seam) |
| discovery-guilds | 2 + 4 | **split:** read-poverty/`whois`→P2; guilds/cross-harbor→P4 |
| `00-HARBOR-EDIFICE.md` | — | **superseded by this doc** |
| `website-v2/src/data/whitePapers.ts` | — | migrate registry 7 → 4 (`axis`/`chapter` retired) |

**Downstream PRs:** #373 (cohesion sweep) rebases onto the 4-paper roster + this
vocabulary — its figure fixes and de-troping survive; the "Floors × Beams"
banner is replaced. #312 (`/library`) renders the wedge-first DAG of four. #360
(revert Trilogy) lands as a noise-cut.

---

## 4. What this supersedes

- `00-HARBOR-EDIFICE.md` — the Floors × Beams 4×4 grid and the 8-paper roster
  (incl. the standalone "Beam D / Bounded Authority" paper; containment returns
  to its two real homes: the machine gate in Paper 1, the human gate in Paper 2).
- The linear "four explain / three prove" model and the "Trilogy" sequence — the
  proofs are no longer papers; each lives inline under the claim it earns,
  fronted by the per-claim status table.
