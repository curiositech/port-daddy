# Game Theory — why single-operator coordination needs no sword

**Layer.** L2/L3 seam — *the formal capstone* — of the Port Daddy North Star
(**ADR-0048**, `docs/adr/0048-what-port-daddy-is.md` — *the parent ADR resolving the
stack into L0→L3*). This doc is the load-bearing argument for the whole volume's
thesis: the line between built-L2 and designed-L3 is **the folk-theorem boundary**.

**Audience.** A software engineer with a working math/CS background. Every
game-theory term is defined on first use.

**Honesty discipline (ADR-0045).** **[BUILT]** = code/proof on `origin/main`.
**[DESIGNED]** = accepted ADR, no merged code. **[VISION]** = argued, unspecified.

---

## Scorecard

| # | Quality gate | Verdict | Grounded at |
|---|---|---|---|
| G1 | Is truthful claim-signaling formalized as a game? | **[BUILT]** — prisoner's-dilemma stage game, repeated lift | `whitepaper/source/agent-transactions-whitepaper.tex` §7.4 (`sec:claim-signaling-ic`) |
| G2 | Is the equilibrium machine-checked, not just argued? | **[BUILT]** — Z3 + TLA⁺ in CI | `proofs/economics/delta-threshold.z3`, `proofs/economics/claim_signaling.tla` |
| G3 | Does the proof name its preconditions explicitly? | **[BUILT]** — observable history, persistent identity, δ-threshold | whitepaper §7.4 "Where each condition bites" |
| G4 | Is observable history actually built? | **[BUILT]** — immutable note chain | `lib/sessions.ts` (notes are INSERT-only) |
| G5 | Is persistent identity actually built (single-operator)? | **[BUILT]** — session `worktree_id` anchor | `lib/sessions.ts:46`, `lib/worktree.ts:124` (`getWorktreeId`) |
| G6 | Does the proof correctly *fail* under federation? | **[BUILT]** — δ→0 collapse stated as a precondition-removal | whitepaper §7.4 "Remove persistent identity" |
| G7 | Is the daemon a *correlating device* (recommends), or only a *recorder*? | **[VISION]** — records claims, does not yet recommend | `lib/attention.ts` (composes; does not prescribe) |
| G8 | Is the price-of-anarchy claim bounded and honest about what's open? | **[BUILT]** (PoA→1 at full-cleanup-bond limit) / **open** (analytical bound under noise) | whitepaper §6.4 (`aumann1974subjectivity`), abstract |

**One-line grade.** The single-operator equilibrium is the most rigorously
*proven* claim in the entire stack — machine-checked in CI — and it is exactly what
makes L3's economic machinery *unnecessary single-operator and necessary
federated*. The one unrealized lever is making the daemon **recommend**, not just
**record** (G7).

---

## 1. The claim that has to be true

> **Truthful file-claim signaling is a Nash equilibrium of the repeated
> coordination game — for any discount factor δ above the folk-theorem threshold —
> given (a) observable history, (b) persistent identity, and (c) a high δ. All three
> hold inside one operator's box. Federation breaks (b). That single broken
> precondition is why L3 exists.**

A **Nash equilibrium** [Nash 1950] — *a strategy profile in which no player can
improve its payoff by unilaterally changing strategy* — is the right bar because
Port Daddy's coordination is **advisory, not enforced**: the **claim**
(`docs/adr/0038-claim-tree.md` — *an advisory announcement that an agent intends to
touch a file/region; it announces intent, it does not lock*) is a signal an agent
can lie about for free. If telling the truth were not a best response, the whole
coordination layer would be theater. The proof that it *is* a best response is the
formal heart of the system, and it is mechanized — not hand-waved.

---

## 2. The stage game is a prisoner's dilemma (the bad news)

Two agents, **A** and **B**, each choose **T** (Truthful: claim exactly the files
you intend to edit) or **F** (False: claim files you will not touch to block a
rival, or hide files you will touch to dodge scrutiny). The **stage game**
(*the one-shot game played in a single round*) has payoffs, in units calibrated to
the project's **cleanup cost** *c* (the human-plus-compute cost to recover from one
breach — `whitepaper/source/agent-transactions-whitepaper.tex` §6.5,
`sec:cleanup-bound`):

|        | B: T   | B: F   |
|--------|--------|--------|
| **A: T** | (3, 3) | (1, 4) |
| **A: F** | (4, 1) | (0, 0) |

This is a textbook **prisoner's dilemma** [Tucker 1950] — *a game where mutual
cooperation (3,3) beats mutual defection (0,0), yet defection strictly dominates
cooperation for each player individually, so the unique equilibrium is the bad
one*. Here **F strictly dominates T** for each player (4 > 3 and 0 > 1), so the
unique one-shot Nash equilibrium is **(F, F)** — both agents lie, the coordination
signal is destroyed, and the operator is back to recovery archaeology. **Truthful
signaling is not a one-shot equilibrium.** Stage-game rationality alone cannot
sustain coordination. [BUILT — proven in §7.4]

This is the precise, unromantic version of the Hobbesian "state of nature" the
companion paper `../legibility-leviathan.md` argues qualitatively. The swarm
defects not because the agents are malicious but because, played once, defection
dominates.

---

## 3. The repeated game rescues it (the good news)

Agents do not play once. A development project lives for weeks; the same principals
interact across many claims. This converts the one-shot prisoner's dilemma into a
**repeated game** [Friedman 1971] — *the same stage game played over and over by
the same players, in which strategies can condition on history* — and the **folk
theorem** [Fudenberg–Maskin 1986] — *in a repeated game with patient enough players
and observable history, cooperative outcomes unreachable in the one-shot game become
sustainable as equilibria* — says cooperation can now be an equilibrium. Three
ingredients make it bind:

- **Observable history.** Every action is on a public, immutable record — the
  **session note chain** (`lib/sessions.ts` — *notes are inserted, never updated or
  deleted; the only removal is `DELETE FROM sessions … ON DELETE CASCADE`, an
  auditable administrative act, never a lifecycle transition*). A defection cannot
  be hidden, so a punishment strategy has something to trigger on. [BUILT, G4]
- **Persistent identity.** Punishment must fall on the *same* identity that
  defected. Single-operator, identity is anchored to the session's **`worktree_id`**
  (`lib/sessions.ts:46` stores `worktree_id`; `lib/worktree.ts:124` `getWorktreeId()`
  derives it from the git worktree the agent runs in) — an agent cannot cheaply
  shed and re-mint it. [BUILT, G5]
- **A discount factor δ.** **δ** [Shapley 1953] — *the weight a player puts on
  future payoffs relative to the present; δ near 1 means a patient player who values
  tomorrow almost as much as today* — is high for a long-lived project. The
  whitepaper takes **δ ≈ 0.9** as the working operating point (§7.4).

---

## 4. The proof, with the real numbers

**Strategy profile: graduated trigger.** Both agents play **T**. If either plays
**F**, both switch to **F** (mutual punishment) for **k = 3** rounds, then reset to
**T**. **Graduated, not grim** ([grim trigger] = *punish forever after one
defection*): crashes and deliberate defection are indistinguishable to an outside
observer (`docs/research/.../crash-recovery`), so permanent punishment for a
transient infrastructure event would destroy cooperation faster than any saboteur
could (whitepaper §7.4, `sec:crash-recovery`).

**The deviation calculation.** Suppose A contemplates **F** in a round where the
strategy says **T**. With payoffs (c, d, p) = (3, 4, 1) — cooperation, temptation,
punishment (the corrected PD bimatrix: (T,T) = (3,3), (T,F) = (0,4),
(F,T) = (4,0), (F,F) = (1,1)):

- **One-shot gain from deviating:** d − c = 4 − 3 = **1** (paid once, this round).
- **Cost:** three subsequent rounds of (F, F) at p = 1 instead of cooperative
  c = 3, discounted: (c − p)·(δ + δ² + δ³) = 2·(δ + δ² + δ³).
- **At δ = 0.9:** 2·(0.9 + 0.81 + 0.729) = 2·2.439 = **4.878**. Net payoff to the
  deviator: 1 − 4.878 = **−3.878**, strictly negative. **Deviation is strictly
  unprofitable.** [BUILT — §7.4]

> **A note on the numbers in the brief.** Earlier framings of this argument
> circulated with "deviation gain 1 < discounted cost 8.1" and a threshold
> "δ ≥ 0.53," and later with the non-PD bimatrix (1,4)/(4,1)/(0,0) whose
> "δ\* ≈ 0.253" the treatise review voided (F was not dominant in that game, so
> the trigger analysis proved nothing about it). The grounded numbers are:
> discounted punishment cost **4.878** at δ = 0.9, and the critical threshold
> **δ\* ≈ 0.3425**. This doc uses the proven values. Citing the voided figures
> would be exactly the overclaim this volume exists to prevent.

**The critical δ.** The general sustainability condition under a k-round graduated
trigger with payoffs (c, d, p) = (3, 4, 1) is

> one-shot gain  <  discounted punishment cost
> d − c  <  (c − p) · δ(1 − δᵏ)/(1 − δ)

Substituting d − c = 1, c − p = 2, k = 3 gives **1 < 2δ(1 + δ + δ²)**, which solves
to **δ > δ\*₍ₖ₌₃₎ ≈ 0.343**. Under grim trigger (k → ∞) the bound is the closed form
δ > 1/3 ≈ 0.333 — the standard folk-theorem threshold. The three-round window adds
barely 0.009 to the threshold: graduated trigger buys crash-tolerance almost for
free. [BUILT — §7.4]

**Mechanized in CI (G2).** This is not a paper claim. The threshold is the unique
real root in (0,1) of the cubic **2δ³ + 2δ² + 2δ − 1 = 0** (numerically
δ\* ≈ 0.3425), and *both* the root's existence-and-uniqueness in [0.34, 0.35] *and*
a model check that no one-shot deviation produces positive discounted payoff at
δ = 0.35 are mechanized as **`proofs/economics/delta-threshold.z3`** (the Z3 SMT
proof) and **`proofs/economics/claim_signaling.tla`** (the TLA⁺ model). Both run
unattended in CI. The equilibrium is *checked*, not asserted.

---

## 5. Where each precondition bites — and why federation is the cliff

The proof's power is that it states precisely what breaks it. Remove any
precondition and the equilibrium fails in a named way (whitepaper §7.4):

| Remove… | What happens | Built defense (single-operator) |
|---|---|---|
| **Observable history** | The repeated game collapses to repeated one-shot play; no trigger can fire; both play F forever. | Immutable note chain (`lib/sessions.ts`). [BUILT] |
| **Persistent identity** | An agent who re-registers after each defection effectively faces **δ = 0**: punishment falls on a discarded identity. Cooperation is impossible. | `worktree_id` anchor (`lib/worktree.ts`). [BUILT single-operator] |
| **δ below 0.343** | The 3-round trigger is insufficient; very short-lived principals can profitably defect once. | Bonds price these out instead (`lib/bonds.ts`; see `mechanism-design.md`). |
| **δ below 1/3** | No trigger of any duration sustains (T, T). Only the bond mechanism deters defection. | The L3 economic layer. [DESIGNED pricer] |

> **This table *is* the L2/L3 boundary.** The first two rows are [BUILT] inside one
> operator's box — observable history and persistent identity both hold, δ is high,
> so the equilibrium binds and no bond is required. The market layer (L3) is exactly
> what you reach for when a row fails: **federation breaks the "persistent identity"
> row** (an agent on another operator's machine can re-register at will), so δ→0 and
> the equilibrium collapses. There is no game-theoretic rescue left, and economic
> enforcement — priced bonds, an unforgeable oracle, Sybil-resistant reputation —
> must *replace* the lost equilibrium. That is the thesis of this whole volume,
> reduced to one row of a payoff analysis.

### 5.1 The Sybil cliff, named

A **Sybil attack** [Douceur 2002] — *one real party manufacturing many fake
identities to overwhelm a system that assumes identities are scarce* — is the
sharp edge of the broken-identity row. Single-operator, identity is non-forgeable
*by construction*: the daemon mints it and the operator owns every machine, so the
attacker's own box is not in the trust boundary (this is exactly ADR-0050's threat
model, `docs/adr/0050-coast-guard.md` — *"intra-fleet, single-operator, not-a-PKI,
no defense against a hostile process on your own box"*). Federation puts other
operators' boxes inside the boundary; identity is no longer free to mint-and-trust;
the Sybil-reset launders any punishment history for the price of a re-registration.
This is why the L3 design (ADR-0040 non-forgeable identity, the bond ledger) is
*load-bearing for the market and irrelevant to the wedge* — and why building it
early would be solving a problem the single-operator user does not have.

---

## 6. The held lever — daemon as correlator, not recorder

The whitepaper goes one step past Nash. It reads the daemon as a **correlating
device** [Aumann 1974] — *a trusted third party that draws a recommendation tuple
from a publicly known joint distribution, privately tells each player its own
recommendation, and arranges things so that following the recommendation is each
player's best response given what its own recommendation implies about the others'*.
This yields a **correlated equilibrium**, strictly more permissive than Nash, and —
crucially — it can drive the **price of anarchy** [Koutsoupias–Papadimitriou 1999] —
*the worst-case ratio of social cost at an equilibrium to the social optimum* — down
to **1:1** in the limit where bonds cover full cleanup cost and reputation noise is
bounded (whitepaper §6.4, abstract; the analytical bound under realistic noise is
explicitly left open).

**The gap (G7):** today the daemon **records** claims and **composes** what an agent
should see — `lib/attention.ts` (`createAttention` / `compose`: *aggregates the
inbox and subscribed channels into "everything new for this agent," with a stable
JSON shape a SessionStart hook can pin into prompt context*) — but it does **not
recommend** which file to claim or defer. It is a recorder of an equilibrium, not
the correlating device of one. Because the recommendation distribution is not yet
common knowledge, the system sits at a Nash equilibrium with **PoA > 1** rather than
the correlated equilibrium with **PoA → 1** the theory promises.

`pd attention` (the CLI surface for `lib/attention.ts`, `cli/commands/attention.ts`)
is the **seed** of the correlator: it is already the per-agent "here is what is
addressed at you" channel. The unrealized lever is to make it carry *claim
recommendations* drawn from a published distribution — at which point advisory
coordination becomes a genuine correlated equilibrium and the price of anarchy
collapses toward optimal. **[VISION]** — the substrate exists; the recommendation
policy does not.

---

## 7. Why this doc is the capstone

Every other doc in this volume rests on the boundary this one proves:

- `mechanism-design.md` prices the bonds that deter the short-lived defectors the
  equilibrium *cannot* discipline (the δ < 0.343 row of §5).
- `cryptoeconomic-security.md` enumerates the attacks that become live precisely
  when the "persistent identity" precondition breaks (§5.1).
- `context-economics.md` and `legibility.md` are the L2 read-surfaces whose value
  presupposes that, single-operator, coordination is *already* stable — so the
  product can be "make the swarm legible and cheap," not "stop the swarm defecting."

The single most important sentence: **the L2/L3 line is not a product decision, it
is a theorem about where δ stops being high.** Build L2 because the equilibrium
holds; build L3 because federation breaks it.

---

## References

- Nash, J. (1950). *Equilibrium Points in n-Person Games.* PNAS 36(1).
- Tucker, A. W. (1950). The prisoner's dilemma (oral; see Poundstone 1992).
- Shapley, L. (1953). *Stochastic Games.* PNAS 39(10). (Discounting.)
- Friedman, J. (1971). *A Non-cooperative Equilibrium for Supergames.* RES 38(1). (Folk theorem.)
- Fudenberg, D. & Maskin, E. (1986). *The Folk Theorem in Repeated Games with Discounting.* Econometrica 54(3).
- Aumann, R. (1974). *Subjectivity and Correlation in Randomized Strategies.* JME 1(1). (Correlated equilibrium.)
- Koutsoupias, E. & Papadimitriou, C. (1999). *Worst-case Equilibria.* STACS. (Price of anarchy.)
- Douceur, J. (2002). *The Sybil Attack.* IPTPS.
- Port Daddy whitepaper: `whitepaper/source/agent-transactions-whitepaper.tex` §6.4, §6.5, §7.4.
- Machine proofs: `proofs/economics/delta-threshold.z3`, `proofs/economics/claim_signaling.tla`.
